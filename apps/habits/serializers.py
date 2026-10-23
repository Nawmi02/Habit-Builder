from rest_framework import serializers
from django.db.models.functions import Lower, Trim

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


class HabitScheduleSerializer(serializers.ModelSerializer):
    schedule_id = serializers.IntegerField(source="pk", read_only=True)
    habit_id = serializers.IntegerField(source="habit.pk", read_only=True)
    reminder_times = serializers.ListField(
        child=serializers.TimeField(input_formats=["%H:%M", "%H:%M:%S"]),
        required=False,
    )

    class Meta:
        model = HabitSchedule
        fields = [
            "schedule_id", "habit_id", "frequency_type",
            "weekdays", "times_per_week", "target_time", "reminder_time",
            "reminder_times", "reminder_tone",
            "pause_start", "pause_end", "skip_allowed", "max_skip_per_period",
        ]

    def validate(self, data):
        freq = data.get("frequency_type")
        weekdays = data.get("weekdays", [])
        times_per_week = data.get("times_per_week")

        if freq == "WEEKDAYS" and not weekdays:
            raise serializers.ValidationError(
                {"weekdays": "Select at least one weekday."}
            )
        if freq == "TIMES_PER_WEEK" and not times_per_week:
            raise serializers.ValidationError(
                {"times_per_week": "This field is required."}
            )
        times = data.get("reminder_times")
        if times is not None:
            data["reminder_times"] = [time.strftime("%H:%M:%S") for time in times]
            data["reminder_time"] = times[0] if times else None
        elif "reminder_time" in data:
            legacy_time = data["reminder_time"]
            data["reminder_times"] = [legacy_time.strftime("%H:%M:%S")] if legacy_time else []
        return data


class HabitOccurrenceSerializer(serializers.ModelSerializer):
    occurrence_id = serializers.IntegerField(source="pk", read_only=True)
    habit_id = serializers.IntegerField(source="habit.pk", read_only=True)

    class Meta:
        model = HabitOccurrence
        fields = [
            "occurrence_id", "habit_id",
            "scheduled_date", "deadline_at", "started_at", "status",
            "progress_value", "completed_count_slots", "count_sessions",
        ]
        read_only_fields = ["occurrence_id", "habit_id"]


class HabitOccurrenceDetailSerializer(serializers.ModelSerializer):
    """
    Detailed occurrence with nested habit info.
    Used in the checklist endpoint.
    """
    occurrence_id = serializers.IntegerField(source="pk", read_only=True)
    habit_id = serializers.IntegerField(source="habit.pk", read_only=True)
    name = serializers.CharField(source="habit.name", read_only=True)
    icon = serializers.CharField(source="habit.icon", read_only=True)
    color = serializers.CharField(source="habit.color", read_only=True)
    habit_type = serializers.CharField(source="habit.habit_type", read_only=True)
    target_type = serializers.CharField(source="habit.target_type", read_only=True)
    target_value = serializers.IntegerField(source="habit.target_value", read_only=True)
    duration_minutes = serializers.IntegerField(source="habit.duration_minutes", read_only=True, allow_null=True)
    target_unit = serializers.CharField(source="habit.target_unit", read_only=True)
    time_of_day = serializers.CharField(source="habit.time_of_day", read_only=True)

    class Meta:
        model = HabitOccurrence
        fields = [
            "occurrence_id", "habit_id", "name", "icon", "color",
            "habit_type", "target_type", "target_value", "duration_minutes", "target_unit",
            "time_of_day", "scheduled_date", "deadline_at", "status",
            "started_at", "progress_value", "completed_count_slots", "count_sessions",
        ]


class CountProgressInputSerializer(serializers.Serializer):
    increment = serializers.IntegerField(min_value=1, default=1)
    slot_index = serializers.IntegerField(min_value=0, required=False)
    source = serializers.ChoiceField(choices=["APP", "REMINDER", "SYNC"], default="APP")
    mood = serializers.CharField(required=False, allow_blank=True, default="")


class CountActionInputSerializer(serializers.Serializer):
    count_index = serializers.IntegerField(min_value=0)
    action = serializers.ChoiceField(choices=["START", "NOT_YET", "COMPLETE", "FAIL", "SKIP"])


class CompletionRecordSerializer(serializers.ModelSerializer):
    completion_id = serializers.IntegerField(source="pk", read_only=True)
    occurrence_id = serializers.IntegerField(source="occurrence.pk", read_only=True)
    skip_reason_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = CompletionRecord
        fields = [
            "completion_id", "occurrence_id", "progress_value", "completed_at",
            "source", "note", "mood", "skip_reason_id", "synced_at",
        ]
        read_only_fields = ["completion_id", "occurrence_id", "synced_at"]


class SkipReasonSerializer(serializers.ModelSerializer):
    reason_id = serializers.IntegerField(source="pk", read_only=True)

    class Meta:
        model = SkipReason
        fields = ["reason_id", "name", "description", "is_active"]
        read_only_fields = fields


class StreakSerializer(serializers.ModelSerializer):
    streak_id = serializers.IntegerField(source="pk", read_only=True)
    habit_id = serializers.IntegerField(source="habit.pk", read_only=True)

    class Meta:
        model = Streak
        fields = [
            "streak_id", "habit_id", "current_streak", "best_streak",
            "last_completed_date", "last_skipped_date", "strength_score",
            "freeze_count", "updated_at",
        ]
        read_only_fields = fields


class ReminderSerializer(serializers.ModelSerializer):
    reminder_id = serializers.IntegerField(source="pk", read_only=True)
    occurrence_id = serializers.PrimaryKeyRelatedField(
        source="occurrence", queryset=HabitOccurrence.objects.all()
    )

    class Meta:
        model = Reminder
        fields = [
            "reminder_id", "occurrence_id", "reminder_type", "escalation_level",
            "scheduled_at", "status", "sent_at", "delivery_status",
        ]
        read_only_fields = ["reminder_id", "status", "sent_at", "delivery_status"]

    def validate_occurrence_id(self, occurrence):
        if occurrence.habit.user_id != self.context["request"].user.pk:
            raise serializers.ValidationError("Occurrence does not belong to you.")
        if occurrence.status != HabitOccurrence.Status.PENDING:
            raise serializers.ValidationError("Reminders require a pending occurrence.")
        return occurrence


class UserRewardSerializer(serializers.ModelSerializer):
    reward_id = serializers.IntegerField(source="pk", read_only=True)
    user_id = serializers.IntegerField(source="user.pk", read_only=True)

    class Meta:
        model = UserReward
        fields = ["reward_id", "user_id", "total_points", "level", "updated_at"]
        read_only_fields = fields


class CompletionInputSerializer(serializers.Serializer):
    progress_value = serializers.IntegerField(min_value=0, required=False)
    completed_at = serializers.DateTimeField(required=False)
    source = serializers.ChoiceField(choices=CompletionRecord.Source.choices, required=False)
    note = serializers.CharField(required=False, allow_blank=True)
    mood = serializers.CharField(required=False, allow_blank=True, max_length=32)


class SkipInputSerializer(serializers.Serializer):
    skip_reason_id = serializers.PrimaryKeyRelatedField(
        source="skip_reason",
        queryset=SkipReason.objects.filter(is_active=True),
        required=False,
        allow_null=True,
    )
    source = serializers.ChoiceField(choices=CompletionRecord.Source.choices, required=False)
    note = serializers.CharField(required=False, allow_blank=True)


class HabitSerializer(serializers.ModelSerializer):
    habit_id = serializers.IntegerField(source="pk", read_only=True)
    user_id = serializers.IntegerField(source="user.pk", read_only=True)
    schedule = HabitScheduleSerializer(required=False)

    class Meta:
        model = Habit
        fields = [
            "habit_id", "user_id", "name", "habit_type",
            "icon", "color", "target_type", "target_value", "target_unit", "duration_minutes",
            "time_of_day", "status", "start_date", "created_at", "updated_at",
            "schedule",
        ]
        read_only_fields = ["habit_id", "user_id", "status", "created_at", "updated_at"]

    def validate(self, attrs):
        user = self.context["request"].user
        if "name" in attrs:
            cleaned_name = attrs["name"].strip()
            if not cleaned_name:
                raise serializers.ValidationError({"name": "Habit name cannot be empty."})
            duplicates = Habit.objects.annotate(
                _normalized_name=Lower(Trim("name")),
            ).filter(
                user=user,
                _normalized_name=cleaned_name.lower(),
            ).exclude(status=Habit.Status.DELETED)
            if self.instance is not None:
                duplicates = duplicates.exclude(pk=self.instance.pk)
            if duplicates.exists():
                raise serializers.ValidationError({"name": "You've already listed this habit."})
            attrs["name"] = cleaned_name

        habit_type = attrs.get("target_type", getattr(self.instance, "target_type", Habit.TargetType.YES_NO))
        target_value = attrs.get("target_value", getattr(self.instance, "target_value", 1))
        duration_minutes = attrs.get("duration_minutes", getattr(self.instance, "duration_minutes", None))
        if habit_type == Habit.TargetType.COUNT and target_value < 1:
            raise serializers.ValidationError({"target_value": "Count target must be at least 1."})
        if duration_minutes is not None and duration_minutes < 0:
            raise serializers.ValidationError({"duration_minutes": "Duration cannot be negative."})
        schedule = attrs.get("schedule")
        if schedule is not None:
            times = schedule.get("reminder_times")
            reminder_enabled = schedule.get("reminder_time", getattr(getattr(self.instance, "schedule", None), "reminder_time", None)) is not None
            if reminder_enabled and habit_type == Habit.TargetType.COUNT and times is not None and len(times) != target_value:
                raise serializers.ValidationError({"schedule": {"reminder_times": "Set one reminder time for each count."}})
        return attrs

    def create(self, validated_data):
        schedule_data = validated_data.pop("schedule", None)
        user = self.context["request"].user

        habit = Habit.objects.create(user=user, **validated_data)

        if schedule_data:
            HabitSchedule.objects.create(habit=habit, **schedule_data)

        return habit

    def update(self, instance, validated_data):
        schedule_data = validated_data.pop("schedule", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if schedule_data:
            schedule, _ = HabitSchedule.objects.get_or_create(habit=instance)
            for attr, value in schedule_data.items():
                setattr(schedule, attr, value)
            schedule.save()

        return instance
