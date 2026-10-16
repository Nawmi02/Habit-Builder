"""
ER entity 1: USER
ER entity 13: DEVICE_TOKEN

Field names follow the ER diagram exactly.
"""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.core.exceptions import ValidationError
from django.db import models

from .managers import UserManager


def validate_time_zone(value):
    """time_zone must be a valid IANA name, e.g. Asia/Dhaka."""
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValidationError(f"'{value}' is not a valid IANA time zone.")


class User(AbstractBaseUser, PermissionsMixin):
    """
    ER entity 1: USER

    user_id (PK)         -> Django default `id`      (API name: user_id)
    password_hash        -> inherited `password`     (Argon2 hash)
    """

    class Theme(models.TextChoices):
        LIGHT = "LIGHT", "Light"
        DARK = "DARK", "Dark"
        SYSTEM = "SYSTEM", "System"

    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)
    time_zone = models.CharField(
        max_length=64,
        default="Asia/Dhaka",
        validators=[validate_time_zone],
    )
    notifications_enabled = models.BooleanField(default=True)
    theme = models.CharField(
        max_length=10,
        choices=Theme.choices,
        default=Theme.SYSTEM,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Not in ER, needed by Django auth/admin
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    class Meta:
        db_table = "users"   # ER name: USER ("user" is reserved in PostgreSQL)
        verbose_name = "User"
        verbose_name_plural = "Users"

    def __str__(self):
        return self.email


class DeviceToken(models.Model):
    """
    ER entity 13: DEVICE_TOKEN

    device_id (PK)       -> Django default `id`      (API name: device_id)
    """

    class Platform(models.TextChoices):
        ANDROID = "ANDROID", "Android"
        IOS = "IOS", "iOS"
        WEB = "WEB", "Web"

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="devices",
    )
    push_token = models.CharField(max_length=255, unique=True)
    platform = models.CharField(max_length=10, choices=Platform.choices)
    last_active = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "device_token"

    def __str__(self):
        return f"{self.platform} - {self.user_id}"