"""
ER entity 2: HABIT
ER entity 3: HABIT_SCHEDULE
ER entity 4: HABIT_OCCURRENCE

Field names follow the ER diagram exactly.
FKs to other apps use strings / settings.AUTH_USER_MODEL, never direct imports.
"""

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models


class Habit(models.Model):
    """
    ER entity 2: HABIT

    habit_id (PK)        -> Django default `id`      (API name: habit_id)
    user_id (FK)         -> `user`                   (API name: user_id)
    """

    class HabitType(models.TextChoices):
        GOOD = "GOOD", "Good habit"
        BAD = "BAD", "Bad habit"

    class TargetType(models.TextChoices):
        YES_NO = "YES_NO", "Yes / No"
        COUNT = "COUNT", "Count"
        DURATION = "DURATION", "Duration"

    class TimeOfDay(models.TextChoices):
        MORNING = "MORNING", "Morning"
        AFTERNOON = "AFTERNOON", "Afternoon"
        EVENING = "EVENING", "Evening"
        ANYTIME = "ANYTIME", "Anytime"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        PAUSED = "PAUSED", "Paused"
        DELETED = "DELETED", "Deleted"   # soft delete

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="habits",
    )
    name = models.CharField(max_length=100)
    habit_type = models.CharField(
        max_length=4, choices=HabitType.choices, default=HabitType.GOOD
    )
    icon = models.CharField(max_length=50, blank=True)
    color = models.CharField(
        max_length=7,
        default="#4F46E5",
        validators=[
            RegexValidator(r"^#[0-9A-Fa-f]{6}$", "Use a hex color like #4F46E5")
        ],
    )
    target_type = models.CharField(
        max_length=8, choices=TargetType.choices, default=TargetType.YES_NO
    )
    target_value = models.PositiveIntegerField(
        default=1, validators=[MinValueValidator(1)]
    )
    target_unit = models.CharField(max_length=20, blank=True)
    time_of_day = models.CharField(
        max_length=9, choices=TimeOfDay.choices, default=TimeOfDay.ANYTIME
    )
    status = models.CharField(
        max_length=7, choices=Status.choices, default=Status.ACTIVE
    )
    start_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "habit"
        indexes = [models.Index(fields=["user", "status"])]

    def __str__(self):
        return f"{self.name} ({self.user_id})"


class HabitSchedule(models.Model):
    """
    ER entity 3: HABIT_SCHEDULE (one per habit)

    schedule_id (PK)     -> Django default `id`      (API name: schedule_id)
    habit_id (FK)        -> `habit`                  (API name: habit_id)
    """

    class FrequencyType(models.TextChoices):
        DAILY = "DAILY", "Daily"
        WEEKDAYS = "WEEKDAYS", "Selected weekdays"
        TIMES_PER_WEEK = "TIMES_PER_WEEK", "X times per week"

    habit = models.OneToOneField(
        Habit, on_delete=models.CASCADE, related_name="schedule"
    )
    frequency_type = models.CharField(max_length=14, choices=FrequencyType.choices)
    # 0 = Monday ... 6 = Sunday (Python's date.weekday())
    weekdays = ArrayField(
        models.PositiveSmallIntegerField(
            validators=[MinValueValidator(0), MaxValueValidator(6)]
        ),
        default=list,
        blank=True,
    )
    times_per_week = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(7)],
    )
    target_time = models.TimeField(null=True, blank=True)
    reminder_time = models.TimeField(null=True, blank=True)
    pause_start = models.DateField(null=True, blank=True)
    pause_end = models.DateField(null=True, blank=True)
    skip_allowed = models.BooleanField(default=True)
    max_skip_per_period = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        db_table = "habit_schedule"

    def clean(self):
        if self.frequency_type == self.FrequencyType.WEEKDAYS and not self.weekdays:
            raise ValidationError({"weekdays": "Select at least one weekday."})
        if (
            self.frequency_type == self.FrequencyType.TIMES_PER_WEEK
            and not self.times_per_week
        ):
            raise ValidationError({"times_per_week": "This field is required."})

    def __str__(self):
        return f"Schedule of habit {self.habit_id}"


class HabitOccurrence(models.Model):
    """
    ER entity 4: HABIT_OCCURRENCE (one scheduled instance of a habit)

    occurrence_id (PK)   -> Django default `id`      (API name: occurrence_id)
    habit_id (FK)        -> `habit`                  (API name: habit_id)
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        COMPLETED = "COMPLETED", "Completed"
        MISSED = "MISSED", "Missed"
        SKIPPED = "SKIPPED", "Skipped"

    habit = models.ForeignKey(
        Habit, on_delete=models.CASCADE, related_name="occurrences"
    )
    scheduled_date = models.DateField()
    deadline_at = models.DateTimeField()
    started_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=9, choices=Status.choices, default=Status.PENDING
    )

    class Meta:
        db_table = "habit_occurrence"
        constraints = [
            models.UniqueConstraint(
                fields=["habit", "scheduled_date"],
                name="uniq_occurrence_per_day",
            )
        ]
        indexes = [
            models.Index(fields=["status", "deadline_at"]),
            models.Index(fields=["habit", "scheduled_date"]),
        ]

    def __str__(self):
        return f"{self.habit_id} {self.scheduled_date} {self.status}"


class SkipReason(models.Model):
    """A selectable reason for skipping a scheduled habit occurrence."""

    name = models.CharField(max_length=80, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "skip_reason"
        ordering = ["name"]

    def __str__(self):
        return self.name


class CompletionRecord(models.Model):
    """The user's completion or skip response for one occurrence."""

    class Source(models.TextChoices):
        APP = "APP", "App"
        REMINDER = "REMINDER", "Reminder"
        SYNC = "SYNC", "Offline sync"

    class Mood(models.TextChoices):
        GREAT = "GREAT", "Great"
        GOOD = "GOOD", "Good"
        NEUTRAL = "NEUTRAL", "Neutral"
        LOW = "LOW", "Low"
        BAD = "BAD", "Bad"

    occurrence = models.OneToOneField(
        HabitOccurrence,
        on_delete=models.CASCADE,
        related_name="completion_record",
    )
    progress_value = models.PositiveIntegerField(default=1)
    completed_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.APP)
    note = models.TextField(blank=True)
    mood = models.CharField(max_length=32, blank=True)
    skip_reason = models.ForeignKey(
        SkipReason,
        on_delete=models.PROTECT,
        related_name="completion_records",
        null=True,
        blank=True,
    )
    synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "completion_record"
        indexes = [models.Index(fields=["completed_at"], name="completion_completed_idx")]

    def __str__(self):
        return f"Completion for occurrence {self.occurrence_id}"


class Streak(models.Model):
    """Current and best consistency data for a habit."""

    habit = models.OneToOneField(Habit, on_delete=models.CASCADE, related_name="streak")
    current_streak = models.PositiveIntegerField(default=0)
    best_streak = models.PositiveIntegerField(default=0)
    last_completed_date = models.DateField(null=True, blank=True)
    last_skipped_date = models.DateField(null=True, blank=True)
    strength_score = models.PositiveSmallIntegerField(default=0)
    freeze_count = models.PositiveSmallIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "streak"
        constraints = [
            models.CheckConstraint(condition=models.Q(strength_score__lte=100), name="streak_strength_lte_100"),
        ]

    def __str__(self):
        return f"Streak for habit {self.habit_id}: {self.current_streak}"


class Reminder(models.Model):
    """A scheduled local or push reminder for a habit occurrence."""

    class Type(models.TextChoices):
        LOCAL = "LOCAL", "Local"
        PUSH = "PUSH", "Push"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SENT = "SENT", "Sent"
        CANCELLED = "CANCELLED", "Cancelled"
        FAILED = "FAILED", "Failed"

    occurrence = models.ForeignKey(
        HabitOccurrence, on_delete=models.CASCADE, related_name="reminders"
    )
    reminder_type = models.CharField(max_length=5, choices=Type.choices, default=Type.PUSH)
    escalation_level = models.PositiveSmallIntegerField(default=1)
    scheduled_at = models.DateTimeField()
    status = models.CharField(max_length=9, choices=Status.choices, default=Status.PENDING)
    sent_at = models.DateTimeField(null=True, blank=True)
    delivery_status = models.CharField(max_length=30, blank=True)

    class Meta:
        db_table = "reminder"
        ordering = ["scheduled_at"]
        indexes = [models.Index(fields=["status", "scheduled_at"], name="reminder_status_sched_idx")]
        constraints = [
            models.UniqueConstraint(
                fields=["occurrence", "reminder_type", "scheduled_at"],
                name="uniq_reminder_occurrence_time",
            ),
        ]

    def __str__(self):
        return f"{self.reminder_type} reminder for occurrence {self.occurrence_id}"


class UserReward(models.Model):
    """Aggregate points and level earned by a user."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reward"
    )
    total_points = models.PositiveIntegerField(default=0)
    level = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "user_reward"

    def __str__(self):
        return f"Rewards for user {self.user_id}: {self.total_points} points"
