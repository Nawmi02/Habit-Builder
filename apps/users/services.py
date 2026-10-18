"""
DEVICE_TOKEN (ER entity 13) helpers for other teammates.

The REMINDER / push teammate (entity 8) uses these instead of querying
DeviceToken directly.
"""

from django.utils import timezone

from .models import DeviceToken


def get_push_tokens(user) -> list:
    """All push tokens of a user. Empty if the user turned notifications off (NFR-15)."""
    if not user.notifications_enabled:
        return []
    return list(user.devices.values_list("push_token", flat=True))


def remove_push_token(push_token: str) -> int:
    """Delete a dead token (FCM said UNREGISTERED: app uninstalled)."""
    deleted, _ = DeviceToken.objects.filter(push_token=push_token).delete()
    return deleted


def touch_device(push_token: str) -> None:
    """Mark a device as active now (e.g. when the app opens)."""
    DeviceToken.objects.filter(push_token=push_token).update(last_active=timezone.now())
