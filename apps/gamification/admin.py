from django.contrib import admin

from .models import Badge, PointTransaction, UserBadge


@admin.register(Badge)
class BadgeAdmin(admin.ModelAdmin):
    list_display = ("id", "code", "name", "condition_type", "condition_value")
    list_filter = ("condition_type",)
    search_fields = ("code", "name")


@admin.register(UserBadge)
class UserBadgeAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "badge", "unlocked_at")
    list_filter = ("badge",)
    search_fields = ("user__email", "badge__name")
    readonly_fields = ("unlocked_at",)


@admin.register(PointTransaction)
class PointTransactionAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "related_type", "points", "reason", "created_at")
    list_filter = ("related_type",)
    search_fields = ("user__email", "reason")
    readonly_fields = ("created_at",)
    date_hierarchy = "created_at"
