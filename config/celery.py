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
}