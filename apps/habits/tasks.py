"""
Celery tasks for habits app.
"""

from celery import shared_task

from .models import Habit
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