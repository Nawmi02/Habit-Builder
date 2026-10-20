"""Atomic completion, miss, streak, and reward updates."""

from datetime import timedelta

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
    if data.get("skip_reason"):
        raise ValidationError({"skip_reason": "A completed occurrence cannot have a skip reason."})

    progress_value = data.get("progress_value", occurrence.habit.target_value)
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
    occurrence.save(update_fields=["status"])
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
    schedule = getattr(occurrence.habit, "schedule", None)
    is_bad_habit = occurrence.habit.habit_type == Habit.HabitType.BAD
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
        progress_value=0,
        source=data.get("source", CompletionRecord.Source.APP),
        note=data.get("note", ""),
        skip_reason=reason,
        synced_at=timezone.now() if data.get("source") == CompletionRecord.Source.SYNC else None,
    )
    occurrence.status = HabitOccurrence.Status.SKIPPED
    occurrence.save(update_fields=["status"])
    _cancel_pending_reminders(occurrence, "occurrence_skipped")

    streak = _update_streak(occurrence.habit, occurrence, positive=positive)
    if positive:
        _streak_rewards(occurrence.habit, streak, occurrence.scheduled_date)
    return record, streak, _current_reward(user)


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
    occurrence.save(update_fields=["status"])
    if record is not None:
        record.delete()

    streak = _rebuild_streak(occurrence.habit)
    return occurrence, streak, _current_reward(user)
