"""
Seed the BADGE catalogue (PRD 11.7 and 18: 7-Day Streak, First 100 Check-ins ...).
Safe to run again: update_or_create by the unique `code`.
"""

from django.db import migrations

BADGES = [
    # code,          name,                  description,                                      condition_type,   value
    ("first-checkin", "First Step",          "Complete your first habit.",                     "TOTAL_CHECKINS", 1),
    ("streak-7",      "7-Day Streak",        "Keep a habit going for 7 days in a row.",        "STREAK_DAYS",    7),
    ("streak-30",     "30-Day Streak",       "Keep a habit going for 30 days in a row.",       "STREAK_DAYS",    30),
    ("checkins-100",  "First 100 Check-ins", "Complete habits 100 times in total.",            "TOTAL_CHECKINS", 100),
]


def seed_badges(apps, schema_editor):
    Badge = apps.get_model("gamification", "Badge")
    for code, name, description, condition_type, value in BADGES:
        Badge.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "description": description,
                "condition_type": condition_type,
                "condition_value": value,
            },
        )


def remove_badges(apps, schema_editor):
    Badge = apps.get_model("gamification", "Badge")
    Badge.objects.filter(code__in=[b[0] for b in BADGES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('gamification', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed_badges, remove_badges),
    ]
