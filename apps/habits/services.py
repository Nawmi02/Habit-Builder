"""
Occurrence generation service.

When a habit is created, edited, or resumed, we generate occurrences
for the next HORIZON_DAYS (default 7).

According to ER:
- Daily habit → 1 occurrence per day
- Weekdays habit → 1 occurrence on selected weekdays
- Times-per-week habit → N occurrences per week, one per day from Monday
  (or the start date), each due by Sunday
"""

from datetime import date, datetime, time, timedelta

from django.utils import timezone

from .models import Habit, HabitOccurrence, HabitSchedule, Reminder

HORIZON_DAYS = 7


def _user_today(user) -> date:
    """Return today's date in the user's timezone."""
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


def _occurrence_deadline(user, day: date, schedule: HabitSchedule):
    """Give a scheduled habit two hours to start/check in after its reminder."""
    reminder_times = schedule.reminder_times or ([schedule.reminder_time] if schedule.reminder_time else [])
    if not reminder_times:
        return _end_of_local_day(user, day)
    from zoneinfo import ZoneInfo

    try:
        tz = ZoneInfo(user.time_zone)
    except Exception:
        tz = ZoneInfo("UTC")
    last_reminder = max(time.fromisoformat(value) if isinstance(value, str) else value for value in reminder_times)
    return (datetime.combine(day, last_reminder, tzinfo=tz) + timedelta(hours=2)).astimezone(ZoneInfo("UTC"))


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
                    deadline_at=_occurrence_deadline(user, day, schedule),
                )
            )

        elif schedule.frequency_type == HabitSchedule.FrequencyType.WEEKDAYS:
            if day.weekday() in (schedule.weekdays or []):
                rows.append(
                    HabitOccurrence(
                        habit=habit,
                        scheduled_date=day,
                    deadline_at=_occurrence_deadline(user, day, schedule),
                    )
                )

        elif schedule.frequency_type == HabitSchedule.FrequencyType.TIMES_PER_WEEK:
            # N occurrences per week. Each one gets its own day (the table allows
            # one occurrence per habit per day), starting on Monday or on the
            # habit's start date, and all of them can be done until Sunday.
            monday = day - timedelta(days=day.weekday())
            if monday in weeks_seen:
                continue
            weeks_seen.add(monday)

            sunday = monday + timedelta(days=6)
            first_day = max(monday, habit.start_date)
            n = schedule.times_per_week or 1

            for slot in range(n):
                slot_day = first_day + timedelta(days=slot)
                if slot_day > sunday:
                    break          # habit started late in the week: fewer slots left
                rows.append(
                    HabitOccurrence(
                        habit=habit,
                        scheduled_date=slot_day,
                        deadline_at=_end_of_local_day(user, sunday),
                    )
                )

    if not rows:
        return 0

    # ignore_conflicts uses the unique constraint (habit, scheduled_date)
    created = HabitOccurrence.objects.bulk_create(rows, ignore_conflicts=True)

    # Materialize each schedule reminder for the generated occurrences. The unique
    # constraint makes this safe when the hourly occurrence task runs repeatedly.
    reminder_times = schedule.reminder_times or ([schedule.reminder_time] if schedule.reminder_time else [])
    if reminder_times:
        from datetime import datetime

        from zoneinfo import ZoneInfo

        try:
            user_tz = ZoneInfo(user.time_zone)
        except Exception:
            user_tz = ZoneInfo("UTC")
        dates = {row.scheduled_date for row in rows}
        occurrences = HabitOccurrence.objects.filter(
            habit=habit, scheduled_date__in=dates
        )
        for occurrence in occurrences.filter(started_at__isnull=True):
            deadline = _occurrence_deadline(user, occurrence.scheduled_date, schedule)
            if occurrence.deadline_at != deadline:
                occurrence.deadline_at = deadline
                occurrence.save(update_fields=["deadline_at"])
        now = timezone.now()
        reminders = [
            Reminder(
                occurrence=occurrence,
                reminder_type=Reminder.Type.PUSH,
                scheduled_at=scheduled_at,
            )
            for occurrence in occurrences
            for reminder_time in reminder_times
            for scheduled_at in [datetime.combine(
                occurrence.scheduled_date,
                time.fromisoformat(reminder_time) if isinstance(reminder_time, str) else reminder_time,
                tzinfo=user_tz,
            ).astimezone(ZoneInfo("UTC"))]
            if scheduled_at > now
        ]
        Reminder.objects.bulk_create(reminders, ignore_conflicts=True)

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
