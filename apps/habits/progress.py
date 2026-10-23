"""Atomic completion, miss, streak, and reward updates."""

from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import (
    Habit,
    HabitOccurrence,
    Reminder,
    Streak,
    UserReward,
)
from apps.tracking.models import CompletionRecord


def _is_positive_action(habit, *, action):
    """Good habits succeed on completion; bad habits succeed on avoidance."""
    if habit.habit_type == Habit.HabitType.BAD:
        return action == "avoid"
    return action == "complete"


def _update_streak(habit, occurrence, *, positive):
    streak, _ = Streak.objects.select_for_update().get_or_create(habit=habit)
    is_bad_habit = habit.habit_type == Habit.HabitType.BAD
    if positive:
        last_positive_day = (
            streak.last_skipped_date if is_bad_habit else streak.last_completed_date
        )
        if (
            last_positive_day is not None
            and occurrence.scheduled_date - last_positive_day >= timedelta(days=7)
        ):
            streak.current_streak = 0
        streak.current_streak += 1
        if is_bad_habit:
            streak.last_skipped_date = occurrence.scheduled_date
        else:
            streak.last_completed_date = occurrence.scheduled_date
    else:
        streak.current_streak = max(0, streak.current_streak - 1)
        if is_bad_habit:
            streak.last_completed_date = occurrence.scheduled_date
            last_positive_day = streak.last_skipped_date
        else:
            streak.last_skipped_date = occurrence.scheduled_date
            last_positive_day = streak.last_completed_date

        # One missed day only subtracts one. A full seven calendar days without
        # a positive action resets the streak, including for non-daily schedules.
        if (
            last_positive_day is not None
            and occurrence.scheduled_date - last_positive_day >= timedelta(days=7)
        ):
            streak.current_streak = 0

    streak.best_streak = max(streak.best_streak, streak.current_streak)
    window_start = occurrence.scheduled_date - timedelta(days=29)
    recent = habit.occurrences.filter(
        scheduled_date__gte=window_start,
        scheduled_date__lte=occurrence.scheduled_date,
    )
    positive_status = (
        HabitOccurrence.Status.SKIPPED
        if is_bad_habit
        else HabitOccurrence.Status.COMPLETED
    )
    total = recent.count()
    successful = recent.filter(status=positive_status).count()
    streak.strength_score = round(100 * successful / total) if total else 0
    streak.save()
    return streak


def _cancel_pending_reminders(occurrence, reason):
    Reminder.objects.filter(
        occurrence=occurrence, status=Reminder.Status.PENDING
    ).update(status=Reminder.Status.CANCELLED, delivery_status=reason)


def _require_duration_elapsed(occurrence):
    if occurrence.habit.target_type != Habit.TargetType.DURATION:
        return
    if occurrence.started_at is None:
        raise ValidationError({"started_at": "Start this habit before completing its duration target."})
    available_at = occurrence.started_at + timedelta(minutes=occurrence.habit.target_value)
    if timezone.now() < available_at:
        remaining = max(1, int((available_at - timezone.now()).total_seconds() // 60) + 1)
        raise ValidationError({"progress_value": f"The duration target will be ready in about {remaining} minute(s)."})


def _current_reward(user):
    """
    USER_REWARD for the user. Points are not added here: the gamification app
    gives them (POINT_TRANSACTION) when the completion record is saved and keeps
    USER_REWARD.total_points equal to the sum of those rows, including the daily
    bonus and streak bonuses. Adding points here as well would count them twice.
    """
    reward, _ = UserReward.objects.get_or_create(user=user)
    reward.refresh_from_db()
    return reward


def _streak_rewards(habit, streak, day):
    """Streak milestone bonus (7 / 30 days) and streak badges (gamification)."""
    from apps.gamification.services import on_streak_updated

    on_streak_updated(habit, streak.current_streak, day)


@transaction.atomic
def complete_occurrence(*, occurrence_id, user, data):
    occurrence = (
        HabitOccurrence.objects.select_for_update()
        .select_related("habit__user")
        .get(pk=occurrence_id, habit__user=user)
    )
    if occurrence.status != HabitOccurrence.Status.PENDING:
        raise ValidationError({"status": "Only pending occurrences can be completed."})
    _require_duration_elapsed(occurrence)
    if (
        occurrence.habit.target_type == Habit.TargetType.COUNT
        and occurrence.habit.duration_minutes is not None
        and (
            len(occurrence.completed_count_slots or []) < occurrence.habit.target_value
            or len(occurrence.count_sessions or []) < occurrence.habit.target_value
            or any(session.get("state") != "completed" for session in occurrence.count_sessions or [])
        )
    ):
        raise ValidationError({"progress_value": "Finish every count timer before completing this habit."})
    if data.get("skip_reason"):
        raise ValidationError({"skip_reason": "A completed occurrence cannot have a skip reason."})

    progress_value = (
        occurrence.progress_value
        if occurrence.habit.target_type == Habit.TargetType.COUNT
        else data.get("progress_value", occurrence.habit.target_value)
    )
    if progress_value < occurrence.habit.target_value:
        raise ValidationError({
            "progress_value": f"Reach the target of {occurrence.habit.target_value} before completing this occurrence."
        })

    now = timezone.now()
    record = CompletionRecord.objects.create(
        occurrence=occurrence,
        progress_value=progress_value,
        completed_at=data.get("completed_at") or now,
        source=data.get("source", CompletionRecord.Source.APP),
        note=data.get("note", ""),
        mood=data.get("mood", ""),
        synced_at=now if data.get("source") == CompletionRecord.Source.SYNC else None,
    )
    occurrence.status = HabitOccurrence.Status.COMPLETED
    occurrence.progress_value = max(occurrence.progress_value, progress_value)
    occurrence.save(update_fields=["status", "progress_value"])
    _cancel_pending_reminders(occurrence, "occurrence_completed")

    positive = _is_positive_action(occurrence.habit, action="complete")
    streak = _update_streak(occurrence.habit, occurrence, positive=positive)
    if positive:
        _streak_rewards(occurrence.habit, streak, occurrence.scheduled_date)
    return record, streak, _current_reward(user)


@transaction.atomic
def skip_occurrence(*, occurrence_id, user, data):
    occurrence = (
        # Lock only the occurrence row. ``habit__schedule`` is nullable, and
        # PostgreSQL cannot apply FOR UPDATE to the nullable side of that join.
        HabitOccurrence.objects.select_for_update(of=("self",))
        .select_related("habit__schedule")
        .get(pk=occurrence_id, habit__user=user)
    )
    if occurrence.status != HabitOccurrence.Status.PENDING:
        raise ValidationError({"status": "Only pending occurrences can be skipped."})
    _require_duration_elapsed(occurrence)
    schedule = getattr(occurrence.habit, "schedule", None)
    is_bad_habit = occurrence.habit.habit_type == Habit.HabitType.BAD
    if (
        occurrence.habit.target_type == Habit.TargetType.COUNT
        and data.get("source") != CompletionRecord.Source.REMINDER
        and occurrence.progress_value < occurrence.habit.target_value
    ):
        raise ValidationError({
            "progress_value": f"Complete all {occurrence.habit.target_value} counts before resolving this occurrence."
        })
    if not is_bad_habit and schedule and not schedule.skip_allowed:
        raise ValidationError({"status": "Skipping is disabled for this habit."})
    if not is_bad_habit and schedule and schedule.max_skip_per_period:
        period_start = occurrence.scheduled_date - timedelta(days=occurrence.scheduled_date.weekday())
        period_end = period_start + timedelta(days=6)
        skipped_count = occurrence.habit.occurrences.filter(
            scheduled_date__range=(period_start, period_end),
            status=HabitOccurrence.Status.SKIPPED,
        ).count()
        if skipped_count >= schedule.max_skip_per_period:
            raise ValidationError({"status": "Skip limit reached for this week."})

    positive = _is_positive_action(occurrence.habit, action="avoid")
    reason = data.get("skip_reason")
    if not positive and reason is None:
        raise ValidationError({"skip_reason_id": "Select a reason for skipping this good habit."})
    record = CompletionRecord.objects.create(
        occurrence=occurrence,
        progress_value=data.get("progress_value", 0),
        source=data.get("source", CompletionRecord.Source.APP),
        note=data.get("note", ""),
        skip_reason=reason,
        synced_at=timezone.now() if data.get("source") == CompletionRecord.Source.SYNC else None,
    )
    occurrence.status = HabitOccurrence.Status.SKIPPED
    occurrence.progress_value = max(occurrence.progress_value, data.get("progress_value", 0))
    occurrence.save(update_fields=["status", "progress_value"])
    _cancel_pending_reminders(occurrence, "occurrence_skipped")

    streak = _update_streak(occurrence.habit, occurrence, positive=positive)
    if positive:
        _streak_rewards(occurrence.habit, streak, occurrence.scheduled_date)
    return record, streak, _current_reward(user)


def _count_sessions(occurrence):
    sessions = list(occurrence.count_sessions or [])
    while len(sessions) < occurrence.habit.target_value:
        sessions.append({"state": "pending", "attempt": 0})
    return sessions


def _finish_count_occurrence(occurrence, user):
    completion_data = {
        "progress_value": occurrence.progress_value,
        "source": CompletionRecord.Source.REMINDER,
        "mood": "GOOD",
    }
    if occurrence.habit.habit_type == Habit.HabitType.BAD:
        return skip_occurrence(occurrence_id=occurrence.pk, user=user, data=completion_data)
    return complete_occurrence(occurrence_id=occurrence.pk, user=user, data=completion_data)


@transaction.atomic
def apply_count_action(*, occurrence_id, user, count_index, action):
    """Apply one count slot's reminder response and resolve the occurrence at its final slot."""
    occurrence = (
        HabitOccurrence.objects.select_for_update(of=("self",))
        .select_related("habit__user")
        .get(pk=occurrence_id, habit__user=user)
    )
    if occurrence.status != HabitOccurrence.Status.PENDING:
        raise ValidationError({"status": "This habit is already resolved for today."})
    if occurrence.habit.target_type != Habit.TargetType.COUNT:
        raise ValidationError({"target_type": "This action requires a count habit."})
    if count_index >= occurrence.habit.target_value:
        raise ValidationError({"count_index": "This count is outside the target."})

    sessions = _count_sessions(occurrence)
    session = dict(sessions[count_index])
    now = timezone.now()
    duration = timedelta(minutes=occurrence.habit.duration_minutes or 0)
    streak = reward = record = None
    completed = False

    if action == "START":
        if count_index in (occurrence.completed_count_slots or []):
            raise ValidationError({"count_index": "This count is already complete."})
        if occurrence.habit.duration_minutes is None:
            occurrence, completed, record, streak, reward = record_count_progress(
                occurrence_id=occurrence.pk,
                user=user,
                data={"increment": 1, "slot_index": count_index, "source": CompletionRecord.Source.REMINDER, "mood": "GOOD"},
            )
            session.update({"state": "completed" if completed else "pending"})
            return occurrence, completed, session, streak, reward
        retry_until = session.get("retry_until")
        if session.get("state") == "waiting" and retry_until and now >= datetime.fromisoformat(retry_until):
            raise ValidationError({"status": "The one-hour start window has ended."})
        if session.get("state") == "running":
            return occurrence, False, session, None, None
        session.update({
            "state": "running",
            "attempt": int(session.get("attempt", 0)) + 1,
            "started_at": now.isoformat(),
            "finish_at": (now + duration).isoformat(),
            "retry_until": None,
        })
    elif action == "NOT_YET":
        if session.get("state") not in ("pending", "failed", "waiting"):
            raise ValidationError({"status": "This count cannot be postponed now."})
        if session.get("state") != "waiting":
            session.update({"state": "waiting", "retry_until": (now + timedelta(hours=1)).isoformat()})
    elif action in ("COMPLETE", "FAIL"):
        if occurrence.habit.duration_minutes is None or session.get("state") != "running" or not session.get("finish_at"):
            raise ValidationError({"status": "Start this count before answering its target prompt."})
        finish_at = datetime.fromisoformat(session["finish_at"])
        if now < finish_at:
            raise ValidationError({"status": "The count duration has not finished yet."})
        if action == "FAIL":
            from apps.gamification.services import apply_point_penalty

            session["state"] = "failed"
            apply_point_penalty(
                user, 5,
                f"Count target not achieved: occurrence {occurrence.pk}, count {count_index}, attempt {session.get('attempt', 1)}",
            )
        else:
            session.update({"state": "completed", "completed_at": now.isoformat()})
            slots = sorted(set(occurrence.completed_count_slots or []) | {count_index})
            occurrence.completed_count_slots = slots
            occurrence.progress_value = len(slots)
            if len(slots) >= occurrence.habit.target_value:
                sessions[count_index] = session
                occurrence.count_sessions = sessions
                occurrence.save(update_fields=["count_sessions", "completed_count_slots", "progress_value"])
                record, streak, reward = _finish_count_occurrence(occurrence, user)
                completed = True
    elif action == "SKIP":
        occurrence.status = HabitOccurrence.Status.SKIPPED
        occurrence.save(update_fields=["status"])
        _cancel_pending_reminders(occurrence, "occurrence_skipped_by_reminder")
        record = CompletionRecord.objects.create(
            occurrence=occurrence,
            progress_value=occurrence.progress_value,
            source=CompletionRecord.Source.REMINDER,
            note="REMINDER_SKIP_TODAY",
        )
        streak = _update_streak(occurrence.habit, occurrence, positive=False)
        from apps.gamification.services import apply_point_penalty

        apply_point_penalty(user, 20, f"Skipped today: occurrence {occurrence.pk}")
        reward = _current_reward(user)
        return occurrence, False, session, streak, reward
    else:
        raise ValidationError({"action": "Unknown count action."})

    sessions[count_index] = session
    occurrence.count_sessions = sessions
    occurrence.save(update_fields=["count_sessions", "completed_count_slots", "progress_value"])
    if completed:
        occurrence.refresh_from_db()
    return occurrence, completed, session, streak, reward


@transaction.atomic
def expire_waiting_count_sessions(now=None):
    """Apply the one-time -1 streak / -10 point penalty after a count's retry hour."""
    now = now or timezone.now()
    expired = 0
    ids = HabitOccurrence.objects.filter(
        status=HabitOccurrence.Status.PENDING,
        habit__target_type=Habit.TargetType.COUNT,
        habit__status=Habit.Status.ACTIVE,
    ).values_list("pk", flat=True)[:1000]
    from apps.gamification.services import apply_point_penalty

    for occurrence_id in ids:
        occurrence = HabitOccurrence.objects.select_for_update(of=("self",)).select_related("habit").get(pk=occurrence_id)
        sessions = list(occurrence.count_sessions or [])
        changed = False
        for count_index, session_value in enumerate(sessions):
            session = dict(session_value)
            retry_until = session.get("retry_until")
            if session.get("state") != "waiting" or not retry_until:
                continue
            if datetime.fromisoformat(retry_until) > now:
                continue
            session.update({"state": "expired", "retry_until": None, "expired_at": now.isoformat()})
            sessions[count_index] = session
            streak = _update_streak(occurrence.habit, occurrence, positive=False)
            apply_point_penalty(
                occurrence.habit.user, 10,
                f"Start window expired: occurrence {occurrence.pk}, count {count_index}",
            )
            expired += 1
            changed = True
        if changed:
            occurrence.count_sessions = sessions
            occurrence.save(update_fields=["count_sessions"])
    return expired


@transaction.atomic
def record_count_progress(*, occurrence_id, user, data):
    """Record one COUNT action; resolve and update streak only at the target."""
    occurrence = (
        HabitOccurrence.objects.select_for_update(of=("self",))
        .select_related("habit__schedule")
        .get(pk=occurrence_id, habit__user=user)
    )
    if occurrence.status != HabitOccurrence.Status.PENDING:
        raise ValidationError({"status": "Only pending occurrences accept progress."})
    if occurrence.habit.target_type != Habit.TargetType.COUNT:
        raise ValidationError({"target_type": "Progress updates are only for count targets."})

    slots = list(occurrence.completed_count_slots or [])
    slot_index = data.get("slot_index")
    if slot_index is not None:
        if slot_index >= occurrence.habit.target_value:
            raise ValidationError({"slot_index": "This reminder is outside the count target."})
        if slot_index in slots:
            return occurrence, False, None, None, None
        slots.append(slot_index)
        occurrence.completed_count_slots = slots

    occurrence.progress_value = min(
        occurrence.habit.target_value,
        occurrence.progress_value + data.get("increment", 1),
    )
    occurrence.save(update_fields=["progress_value", "completed_count_slots"])
    if occurrence.progress_value < occurrence.habit.target_value:
        return occurrence, False, None, None, None

    completion_data = {
        "progress_value": occurrence.progress_value,
        "source": data.get("source", CompletionRecord.Source.APP),
        "mood": data.get("mood", ""),
    }
    if occurrence.habit.habit_type == Habit.HabitType.BAD:
        record, streak, reward = skip_occurrence(
            occurrence_id=occurrence.pk, user=user, data=completion_data
        )
    else:
        record, streak, reward = complete_occurrence(
            occurrence_id=occurrence.pk, user=user, data=completion_data
        )
    occurrence.refresh_from_db()
    return occurrence, True, record, streak, reward


@transaction.atomic
def mark_occurrence_missed(occurrence_id):
    """Mark one overdue occurrence missed and apply its habit's negative action."""
    try:
        occurrence = (
            HabitOccurrence.objects.select_for_update()
            .select_related("habit")
            .get(pk=occurrence_id)
        )
    except HabitOccurrence.DoesNotExist:
        return False
    if (
        occurrence.status != HabitOccurrence.Status.PENDING
        or occurrence.deadline_at > timezone.now()
        or occurrence.habit.status != Habit.Status.ACTIVE
    ):
        return False

    occurrence.status = HabitOccurrence.Status.MISSED
    occurrence.save(update_fields=["status"])
    _cancel_pending_reminders(occurrence, "occurrence_missed")
    already_penalized = (
        occurrence.habit.target_type == Habit.TargetType.COUNT
        and any(session.get("state") == "expired" for session in occurrence.count_sessions or [])
    )
    if not already_penalized:
        _update_streak(occurrence.habit, occurrence, positive=False)
    return True


def _rebuild_streak(habit):
    """
    Recalculate a habit's streak from its resolved occurrences, with the same
    rules as _update_streak. Used after an undo, when the last step must be
    taken back. freeze_count is kept as it is.
    """
    streak, _ = Streak.objects.select_for_update().get_or_create(habit=habit)
    is_bad_habit = habit.habit_type == Habit.HabitType.BAD
    positive_status = (
        HabitOccurrence.Status.SKIPPED if is_bad_habit else HabitOccurrence.Status.COMPLETED
    )
    resolved = habit.occurrences.exclude(
        status=HabitOccurrence.Status.PENDING
    ).order_by("scheduled_date", "pk")

    current = best = 0
    last_completed = last_skipped = None
    last_day = None
    for occ in resolved:
        day = occ.scheduled_date
        positive = occ.status == positive_status
        if positive:
            last_positive = last_skipped if is_bad_habit else last_completed
            if last_positive is not None and day - last_positive >= timedelta(days=7):
                current = 0
            current += 1
            if is_bad_habit:
                last_skipped = day
            else:
                last_completed = day
        else:
            current = max(0, current - 1)
            if is_bad_habit:
                last_completed = day
                last_positive = last_skipped
            else:
                last_skipped = day
                last_positive = last_completed
            if last_positive is not None and day - last_positive >= timedelta(days=7):
                current = 0
        best = max(best, current)
        last_day = day

    streak.current_streak = current
    streak.best_streak = best
    streak.last_completed_date = last_completed
    streak.last_skipped_date = last_skipped
    if last_day is None:
        streak.strength_score = 0
    else:
        recent = habit.occurrences.filter(
            scheduled_date__gte=last_day - timedelta(days=29),
            scheduled_date__lte=last_day,
        )
        total = recent.count()
        successful = recent.filter(status=positive_status).count()
        streak.strength_score = round(100 * successful / total) if total else 0
    streak.save()
    return streak


@transaction.atomic
def undo_occurrence(*, occurrence_id, user):
    """
    FR-08: take back a completion or a skip before the occurrence's deadline.
    The completion record is deleted (gamification removes its points and that
    day's bonus), the occurrence goes back to PENDING and the streak is rebuilt.
    """
    occurrence = (
        HabitOccurrence.objects.select_for_update(of=("self",))
        .select_related("habit")
        .get(pk=occurrence_id, habit__user=user)
    )
    if occurrence.status not in (
        HabitOccurrence.Status.COMPLETED,
        HabitOccurrence.Status.SKIPPED,
    ):
        raise ValidationError({"status": "Only completed or skipped occurrences can be undone."})
    if occurrence.deadline_at <= timezone.now():
        raise ValidationError({"status": "The deadline has passed, so this can no longer be undone."})

    record = CompletionRecord.objects.filter(occurrence=occurrence).first()
    occurrence.status = HabitOccurrence.Status.PENDING
    occurrence.progress_value = 0
    occurrence.completed_count_slots = []
    occurrence.save(update_fields=["status", "progress_value", "completed_count_slots"])
    if record is not None:
        record.delete()

    streak = _rebuild_streak(occurrence.habit)
    return occurrence, streak, _current_reward(user)
