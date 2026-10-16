from django.contrib import admin

from .models import Habit, HabitSchedule, HabitOccurrence


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