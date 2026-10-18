"""
Celery configuration for Habit Builder.
"""

import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("habit_builder")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# Beat schedule
app.conf.beat_schedule = {
    "generate-upcoming-occurrences": {
        "task": "apps.habits.tasks.generate_upcoming_occurrences",
        "schedule": crontab(minute=0),  # hourly
    },
    "send-due-habit-reminders": {
        "task": "apps.habits.tasks.send_due_reminders",
        "schedule": crontab(minute="*"),  # every minute
    },
    "mark-overdue-habit-occurrences": {
        "task": "apps.habits.tasks.mark_overdue_occurrences_missed",
        "schedule": crontab(minute=5),  # hourly, after local-day deadlines
    },
}
