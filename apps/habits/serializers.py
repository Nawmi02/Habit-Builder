from rest_framework import serializers

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

    class Meta:
        model = HabitSchedule
        fields = [
            "schedule_id", "habit_id", "frequency_type",
            "weekdays", "times_per_week", "target_time", "reminder_time",
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
        return data


class HabitOccurrenceSerializer(serializers.ModelSerializer):
    occurrence_id = serializers.IntegerField(source="pk", read_only=True)
    habit_id = serializers.IntegerField(source="habit.pk", read_only=True)

    class Meta:
        model = HabitOccurrence
        fields = [
            "occurrence_id", "habit_id",
            "scheduled_date", "deadline_at", "started_at", "status",
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
    target_unit = serializers.CharField(source="habit.target_unit", read_only=True)
    time_of_day = serializers.CharField(source="habit.time_of_day", read_only=True)

    class Meta:
        model = HabitOccurrence
        fields = [
            "occurrence_id", "habit_id", "name", "icon", "color",
            "habit_type", "target_type", "target_value", "target_unit",
            "time_of_day", "scheduled_date", "deadline_at", "status",
            "started_at",
        ]


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
            "icon", "color", "target_type", "target_value", "target_unit",
            "time_of_day", "status", "start_date", "created_at", "updated_at",
            "schedule",
        ]
        read_only_fields = ["habit_id", "user_id", "status", "created_at", "updated_at"]

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
