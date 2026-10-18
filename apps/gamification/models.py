"""
ER entity 10: POINT_TRANSACTION
ER entity 11: BADGE
ER entity 12: USER_BADGE

(ER entity 13: DEVICE_TOKEN lives in apps.users, next to USER.)

Field names follow the ER diagram exactly.
FKs to other apps use strings / settings.AUTH_USER_MODEL, never direct imports.
"""

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q


class Badge(models.Model):
    """
    ER entity 11: BADGE (the catalogue of badges a user can unlock)

    badge_id (PK)        -> Django default `id`      (API name: badge_id)
    code (UK)            -> `code`                   e.g. "streak-7"
    """

    class ConditionType(models.TextChoices):
        TOTAL_CHECKINS = "TOTAL_CHECKINS", "Total completed habits"
        STREAK_DAYS = "STREAK_DAYS", "Streak length in days"
        TOTAL_POINTS = "TOTAL_POINTS", "Total points"

    code = models.SlugField(unique=True)
    name = models.CharField(max_length=60)
    description = models.CharField(max_length=200)
    condition_type = models.CharField(max_length=20, choices=ConditionType.choices)
    condition_value = models.PositiveIntegerField(validators=[MinValueValidator(1)])

    class Meta:
        db_table = "badge"
        ordering = ["condition_type", "condition_value"]

    def __str__(self):
        return self.name


class UserBadge(models.Model):
    """
    ER entity 12: USER_BADGE (bridge USER <-> BADGE, M:N)

    user_badge_id (PK)   -> Django default `id`      (API name: user_badge_id)
    user_id (FK)         -> `user`                   (API name: user_id)
    badge_id (FK)        -> `badge`                  (API name: badge_id)
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="user_badges",
    )
    badge = models.ForeignKey(
        Badge,
        on_delete=models.CASCADE,
        related_name="user_badges",
    )
    unlocked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "user_badge"
        ordering = ["-unlocked_at"]
        constraints = [
            # a user can unlock each badge only once
            models.UniqueConstraint(fields=["user", "badge"], name="uniq_user_badge"),
        ]

    def __str__(self):
        return f"{self.user_id} - {self.badge_id}"


class PointTransaction(models.Model):
    """
    ER entity 10: POINT_TRANSACTION (history of every point a user earns)

    point_id (PK)        -> Django default `id`      (API name: point_id)
    user_id (FK)         -> `user`                   (API name: user_id)
    completion_id (FK)   -> `completion`             (API name: completion_id)
                            nullable: bonuses (daily, streak, badge) have no completion
    """

    class RelatedType(models.TextChoices):
        COMPLETION = "COMPLETION", "Habit completed"
        DAILY_BONUS = "DAILY_BONUS", "All habits done today"
        STREAK = "STREAK", "Streak milestone"
        BADGE = "BADGE", "Badge unlocked"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="point_transactions",
    )
    completion = models.OneToOneField(
        "tracking.CompletionRecord",
        on_delete=models.CASCADE,       # undo a completion -> its points disappear
        null=True,
        blank=True,
        related_name="point_transaction",
    )
    related_type = models.CharField(max_length=11, choices=RelatedType.choices)
    points = models.IntegerField()
    reason = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "point_transaction"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["user", "created_at"], name="pt_user_created_idx"),
        ]
        constraints = [
            # each bonus (same reason) is given to a user only once
            models.UniqueConstraint(
                fields=["user", "reason"],
                condition=~Q(related_type="COMPLETION"),
                name="uniq_bonus_reason_per_user",
            ),
            # completion points must point at a completion
            models.CheckConstraint(
                condition=~Q(related_type="COMPLETION") | Q(completion__isnull=False),
                name="completion_points_need_completion",
            ),
        ]

    def __str__(self):
        return f"{self.user_id} +{self.points} ({self.related_type})"
