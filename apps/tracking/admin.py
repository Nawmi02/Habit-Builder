from django.contrib import admin

from .models import CompletionRecord


@admin.register(CompletionRecord)
class CompletionRecordAdmin(admin.ModelAdmin):
    list_display = ("id", "occurrence", "progress_value", "completed_at")
    search_fields = ("occurrence__habit__name", "occurrence__habit__user__email")
