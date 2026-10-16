"""
Occurrence generation service.

When a habit is created, edited, or resumed, we generate occurrences
for the next HORIZON_DAYS (default 7).

According to ER:
- Daily habit → 1 occurrence per day
- Weekdays habit → 1 occurrence on selected weekdays
- Times-per-week habit → N occurrences per week (slot 1..N)
"""

from datetime import date, timedelta

from django.utils import timezone

from .models import Habit, HabitOccurrence, HabitSchedule

HORIZON_DAYS = 7


def _user_today(user) -> date:
    """Return today's date in the user's timezone."""
    tz = timezone.pytz.timezone(user.time_zone) if hasattr(timezone, "pytz") else None
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo(user.time_zone)
        return timezone.now().astimezone(tz).date()
    except Exception:
        return timezone.now().date()


def _end_of_local_day(user, day: date):
    """Return 23:59:59 on `day` in user's timezone as UTC datetime."""
    from datetime import datetime, time
    from zoneinfo import ZoneInfo

    try:
        tz = ZoneInfo(user.time_zone)
    except Exception:
        tz = ZoneInfo("UTC")

    local = datetime.combine(day, time(23, 59, 59), tzinfo=tz)
    return local.astimezone(ZoneInfo("UTC"))


def _paused(schedule: HabitSchedule, day: date) -> bool:
    """Check if habit is paused on `day`."""
    if schedule.pause_start is None:
        return False
    pause_end = schedule.pause_end or day
    return schedule.pause_start <= day <= pause_end


def generate_occurrences(habit: Habit, days: int = HORIZON_DAYS) -> int:
    """
    Generate occurrences for `habit` for the next `days` days.

    Returns number of occurrences created.
    """
    if habit.status != Habit.Status.ACTIVE:
        return 0

    try:
        schedule = habit.schedule
    except HabitSchedule.DoesNotExist:
        return 0

    user = habit.user
    start = max(_user_today(user), habit.start_date)

    rows = []
    weeks_seen = set()

    for i in range(days):
        day = start + timedelta(days=i)

        if _paused(schedule, day):
            continue

        if schedule.frequency_type == HabitSchedule.FrequencyType.DAILY:
            rows.append(
                HabitOccurrence(
                    habit=habit,
                    scheduled_date=day,
                    deadline_at=_end_of_local_day(user, day),
                )
            )

        elif schedule.frequency_type == HabitSchedule.FrequencyType.WEEKDAYS:
            if day.weekday() in (schedule.weekdays or []):
                rows.append(
                    HabitOccurrence(
                        habit=habit,
                        scheduled_date=day,
                        deadline_at=_end_of_local_day(user, day),
                    )
                )

        elif schedule.frequency_type == HabitSchedule.FrequencyType.TIMES_PER_WEEK:
            # monday of the week
            monday = day - timedelta(days=day.weekday())
            if monday in weeks_seen:
                continue
            weeks_seen.add(monday)

            sunday = monday + timedelta(days=6)
            n = schedule.times_per_week or 1

            for slot in range(1, n + 1):
                rows.append(
                    HabitOccurrence(
                        habit=habit,
                        scheduled_date=monday,
                        deadline_at=_end_of_local_day(user, sunday),
                    )
                )

    if not rows:
        return 0

    # ignore_conflicts uses the unique constraint (habit, scheduled_date)
    created = HabitOccurrence.objects.bulk_create(rows, ignore_conflicts=True)
    return len(created)


def remove_future_pending(habit: Habit) -> int:
    """
    Delete future PENDING occurrences (used on pause, delete, schedule edit).
    """
    today = _user_today(habit.user)
    deleted, _ = habit.occurrences.filter(
        status=HabitOccurrence.Status.PENDING,
        scheduled_date__gt=today,
    ).delete()
    return deleted