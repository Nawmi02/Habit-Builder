from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User, DeviceToken


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("id", "email", "name", "time_zone", "is_active", "created_at")
    list_filter = ("is_active", "is_staff", "theme", "notifications_enabled")
    search_fields = ("email", "name")
    ordering = ("-created_at",)

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("name", "time_zone")}),
        ("Preferences", {"fields": ("theme", "notifications_enabled")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Important dates", {"fields": ("last_login", "created_at", "updated_at")}),
    )
    readonly_fields = ("created_at", "updated_at", "last_login")

    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "name", "password1", "password2", "time_zone"),
        }),
    )


@admin.register(DeviceToken)
class DeviceTokenAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "platform", "last_active")
    list_filter = ("platform",)
    search_fields = ("user__email", "push_token")
    readonly_fields = ("last_active",)