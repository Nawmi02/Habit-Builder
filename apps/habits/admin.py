from django.contrib import admin

from .models import (
    CompletionRecord,
    Habit,
    HabitOccurrence,
    HabitSchedule,
    Reminder,
    SkipReason,
    Streak,
    UserReward,
)


class HabitScheduleInline(admin.StackedInline):
    model = HabitSchedule
    extra = 0
    can_delete = False


@admin.register(Habit)
class HabitAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "user", "habit_type", "status", "time_of_day", "start_date")
    list_filter = ("habit_type", "status", "time_of_day")
    search_fields = ("name", "user__email")
    inlines = [HabitScheduleInline]
    readonly_fields = ("created_at", "updated_at")


@admin.register(HabitSchedule)
class HabitScheduleAdmin(admin.ModelAdmin):
    list_display = ("id", "habit", "frequency_type", "times_per_week", "reminder_time")
    list_filter = ("frequency_type", "skip_allowed")
    search_fields = ("habit__name",)


@admin.register(HabitOccurrence)
class HabitOccurrenceAdmin(admin.ModelAdmin):
    list_display = ("id", "habit", "scheduled_date", "status", "deadline_at")
    list_filter = ("status", "scheduled_date")
    search_fields = ("habit__name", "habit__user__email")
    date_hierarchy = "scheduled_date"


@admin.register(CompletionRecord)
class CompletionRecordAdmin(admin.ModelAdmin):
    list_display = ("id", "occurrence", "completed_at", "source", "skip_reason")
    list_filter = ("source", "mood")
    search_fields = ("occurrence__habit__name", "note")


@admin.register(SkipReason)
class SkipReasonAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name", "description")


@admin.register(Streak)
class StreakAdmin(admin.ModelAdmin):
    list_display = ("id", "habit", "current_streak", "best_streak", "strength_score")
    search_fields = ("habit__name", "habit__user__email")


@admin.register(Reminder)
class ReminderAdmin(admin.ModelAdmin):
    list_display = ("id", "occurrence", "reminder_type", "scheduled_at", "status")
    list_filter = ("reminder_type", "status", "delivery_status")
    search_fields = ("occurrence__habit__name", "occurrence__habit__user__email")


@admin.register(UserReward)
class UserRewardAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "total_points", "level", "updated_at")
    search_fields = ("user__email", "user__name")
