"""Atomic completion, miss, streak, and reward updates."""

from datetime import timedelta

from django.conf import settings
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


def _award_points(user):
    points = getattr(settings, "HABIT_COMPLETION_POINTS", 10)
    points_per_level = max(1, getattr(settings, "HABIT_POINTS_PER_LEVEL", 100))
    reward, _ = UserReward.objects.select_for_update().get_or_create(user=user)
    reward.total_points += points
    reward.level = reward.total_points // points_per_level + 1
    reward.save(update_fields=["total_points", "level", "updated_at"])
    return reward


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
    reward = _award_points(user) if positive else UserReward.objects.get_or_create(user=user)[0]
    return record, streak, reward


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
    reward = _award_points(user) if positive else UserReward.objects.get_or_create(user=user)[0]
    return record, streak, reward


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
