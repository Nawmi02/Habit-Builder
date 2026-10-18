"""
Celery tasks for habits app.
"""

from celery import shared_task
from django.conf import settings
from django.utils import timezone
from django.utils.module_loading import import_string

from .models import Habit, HabitOccurrence, Reminder
from .progress import mark_occurrence_missed
from .services import generate_occurrences


@shared_task
def generate_upcoming_occurrences():
    """
    Hourly task: top up occurrences for all active habits.
    Maintains 7-day horizon.
    """
    habits = Habit.objects.filter(status=Habit.Status.ACTIVE).select_related(
        "schedule", "user"
    )
    total = 0
    for habit in habits:
        try:
            count = generate_occurrences(habit)
            total += count
        except Exception as e:
            print(f"Error generating occurrences for habit {habit.pk}: {e}")
    return total


@shared_task
def mark_overdue_occurrences_missed():
    """Apply the one-day streak decrease for overdue, unreported occurrences."""
    overdue_ids = HabitOccurrence.objects.filter(
        status=HabitOccurrence.Status.PENDING,
        deadline_at__lte=timezone.now(),
        habit__status=Habit.Status.ACTIVE,
    ).order_by("deadline_at").values_list("pk", flat=True)[:1000]
    missed = 0
    for occurrence_id in overdue_ids:
        missed += mark_occurrence_missed(occurrence_id)
    return missed


@shared_task
def send_due_reminders():
    """Send due push reminders through the configured provider adapter.

    The sender path is intentionally configurable because this project has not
    selected an FCM/APNs provider. The adapter must return a delivery status string.
    """
    sender_path = getattr(settings, "HABIT_REMINDER_SENDER", "")
    if not sender_path:
        return {"sent": 0, "reason": "reminder_sender_not_configured"}

    sender = import_string(sender_path)
    now = timezone.now()
    reminders = Reminder.objects.filter(
        status=Reminder.Status.PENDING,
        reminder_type=Reminder.Type.PUSH,
        scheduled_at__lte=now,
        occurrence__status=HabitOccurrence.Status.PENDING,
        occurrence__habit__status=Habit.Status.ACTIVE,
        occurrence__habit__user__notifications_enabled=True,
    ).select_related("occurrence__habit__user", "occurrence__habit")[:500]

    sent = failed = 0
    for reminder in reminders:
        try:
            delivery_status = sender(reminder.occurrence.habit.user, reminder)
            reminder.status = Reminder.Status.SENT
            reminder.sent_at = timezone.now()
            reminder.delivery_status = str(delivery_status or "delivered")[:30]
            sent += 1
        except Exception as exc:
            reminder.status = Reminder.Status.FAILED
            reminder.delivery_status = f"failed:{type(exc).__name__}"[:30]
            failed += 1
        reminder.save(update_fields=["status", "sent_at", "delivery_status"])

    return {"sent": sent, "failed": failed}
