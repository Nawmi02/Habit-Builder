from collections import defaultdict
from datetime import date
from zoneinfo import ZoneInfo

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import CompletionRecord, Habit, HabitOccurrence, Reminder, SkipReason, Streak, UserReward
from .serializers import (
    HabitSerializer,
    HabitOccurrenceSerializer,
    HabitOccurrenceDetailSerializer,
    CompletionRecordSerializer,
    CompletionInputSerializer,
    SkipInputSerializer,
    SkipReasonSerializer,
    StreakSerializer,
    ReminderSerializer,
    UserRewardSerializer,
)
from .services import generate_occurrences, remove_future_pending
from .progress import complete_occurrence, mark_occurrence_missed, skip_occurrence, undo_occurrence


class HabitViewSet(viewsets.ModelViewSet):
    """
    Habit CRUD API + checklist.

    Endpoints:
    - GET    /api/habits/                    → list habits
    - POST   /api/habits/                    → create habit + schedule
    - GET    /api/habits/{id}/               → retrieve habit
    - PATCH  /api/habits/{id}/               → update habit
    - DELETE /api/habits/{id}/               → soft delete
    - POST   /api/habits/{id}/pause/         → pause
    - POST   /api/habits/{id}/resume/        → resume
    - GET    /api/habits/{id}/occurrences/   → occurrences
    - GET    /api/habits/checklist/          → today's checklist
    """

    serializer_class = HabitSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """Only own habits, excluding soft-deleted."""
        qs = Habit.objects.filter(user=self.request.user).exclude(
            status=Habit.Status.DELETED
        )
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs.select_related("schedule", "user")

    def perform_create(self, serializer):
        """Create habit + generate occurrences."""
        habit = serializer.save()
        generate_occurrences(habit)

    def perform_update(self, serializer):
        """Update habit + regenerate future occurrences."""
        habit = serializer.save()
        remove_future_pending(habit)
        generate_occurrences(habit)

    def perform_destroy(self, instance):
        """Soft delete: mark DELETED."""
        instance.status = Habit.Status.DELETED
        instance.save(update_fields=["status", "updated_at"])
        remove_future_pending(instance)

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        """Pause habit (optional `until` date)."""
        habit = self.get_object()
        until = request.data.get("until")

        habit.status = Habit.Status.PAUSED
        habit.save(update_fields=["status", "updated_at"])

        schedule = getattr(habit, "schedule", None)
        if schedule:
            schedule.pause_start = timezone.now().date()
            schedule.pause_end = until
            schedule.save(update_fields=["pause_start", "pause_end"])

        remove_future_pending(habit)
        return Response(self.get_serializer(habit).data)

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        """Resume paused habit + regenerate occurrences."""
        habit = self.get_object()

        habit.status = Habit.Status.ACTIVE
        habit.save(update_fields=["status", "updated_at"])

        schedule = getattr(habit, "schedule", None)
        if schedule:
            schedule.pause_end = timezone.now().date()
            schedule.save(update_fields=["pause_end"])

        generate_occurrences(habit)
        return Response(self.get_serializer(habit).data)

    @action(detail=True, methods=["get"])
    def occurrences(self, request, pk=None):
        """List occurrences for a habit."""
        habit = self.get_object()
        _expire_user_occurrences(request.user)
        qs = habit.occurrences.all().order_by("scheduled_date")

        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")
        if from_date and to_date:
            qs = qs.filter(scheduled_date__range=[from_date, to_date])

        serializer = HabitOccurrenceSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def streak(self, request, pk=None):
        habit = self.get_object()
        streak, _ = Streak.objects.get_or_create(habit=habit)
        return Response(StreakSerializer(streak).data)

    @action(detail=False, methods=["get"])
    def checklist(self, request):
        """Today's checklist grouped by time_of_day."""
        _expire_user_occurrences(request.user)
        # today's date in user's timezone
        try:
            user_tz = ZoneInfo(request.user.time_zone)
        except Exception:
            user_tz = ZoneInfo("UTC")

        today = timezone.now().astimezone(user_tz).date()

        # optional date override
        date_param = request.query_params.get("date")
        if date_param:
            try:
                today = date.fromisoformat(date_param)
            except ValueError:
                pass

        occurrences = (
            HabitOccurrence.objects.filter(
                habit__user=request.user,
                scheduled_date=today,
            )
            .exclude(habit__status=Habit.Status.DELETED)
            .select_related("habit")
            .order_by("habit__time_of_day", "habit__name")
        )

        groups = defaultdict(list)
        for occ in occurrences:
            groups[occ.habit.time_of_day].append(occ)

        # summary
        total = occurrences.count()
        completed = occurrences.filter(status="COMPLETED").count()
        pending = occurrences.filter(status="PENDING").count()
        missed = occurrences.filter(status="MISSED").count()
        skipped = occurrences.filter(status="SKIPPED").count()
        percent = round(100 * completed / total) if total else 0

        serializer = HabitOccurrenceDetailSerializer

        return Response({
            "date": today,
            "summary": {
                "total": total,
                "completed": completed,
                "pending": pending,
                "missed": missed,
                "skipped": skipped,
                "percent": percent,
            },
            "groups": {
                "MORNING": serializer(groups.get("MORNING", []), many=True).data,
                "AFTERNOON": serializer(groups.get("AFTERNOON", []), many=True).data,
                "EVENING": serializer(groups.get("EVENING", []), many=True).data,
                "ANYTIME": serializer(groups.get("ANYTIME", []), many=True).data,
            },
        })


def _expire_user_occurrences(user):
    """Resolve overdue items when the user opens the app, even without Celery running."""
    from .services import _occurrence_deadline

    pending = HabitOccurrence.objects.filter(
        habit__user=user,
        status=HabitOccurrence.Status.PENDING,
        started_at__isnull=True,
    ).select_related("habit__schedule")
    for occurrence in pending:
        schedule = getattr(occurrence.habit, "schedule", None)
        if schedule:
            deadline = _occurrence_deadline(user, occurrence.scheduled_date, schedule)
            if occurrence.deadline_at != deadline:
                occurrence.deadline_at = deadline
                occurrence.save(update_fields=["deadline_at"])

    overdue = HabitOccurrence.objects.filter(
        habit__user=user,
        habit__status=Habit.Status.ACTIVE,
        status=HabitOccurrence.Status.PENDING,
        deadline_at__lte=timezone.now(),
    ).values_list("pk", flat=True)
    for occurrence_id in overdue:
        mark_occurrence_missed(occurrence_id)


class OccurrenceCompletionView(APIView):
    """Start, complete, or skip an occurrence owned by the caller."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk, action_name):
        from datetime import timedelta
        from django.utils import timezone

        occurrence = get_object_or_404(HabitOccurrence, pk=pk, habit__user=request.user)
        if action_name == "start":
            if occurrence.status != HabitOccurrence.Status.PENDING:
                return Response({"status": "Only pending habits can be started."}, status=400)
            if occurrence.started_at is None:
                duration = occurrence.habit.target_value if occurrence.habit.target_type == Habit.TargetType.DURATION else 30
                occurrence.started_at = timezone.now()
                occurrence.deadline_at = occurrence.started_at + timedelta(minutes=duration + 120)
                occurrence.save(update_fields=["started_at", "deadline_at"])
            return Response(HabitOccurrenceSerializer(occurrence).data)
        if action_name == "undo":
            occurrence, streak, reward = undo_occurrence(
                occurrence_id=occurrence.pk, user=request.user
            )
            return Response(
                {
                    "occurrence": HabitOccurrenceSerializer(occurrence).data,
                    "streak": StreakSerializer(streak).data,
                    "reward": UserRewardSerializer(reward).data,
                }
            )
        if action_name == "complete":
            payload = CompletionInputSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            record, streak, reward = complete_occurrence(
                occurrence_id=occurrence.pk, user=request.user, data=payload.validated_data
            )
            return Response(
                {
                    "completion": CompletionRecordSerializer(record).data,
                    "streak": StreakSerializer(streak).data,
                    "reward": UserRewardSerializer(reward).data,
                },
                status=status.HTTP_201_CREATED,
            )

        if action_name != "skip":
            return Response({"detail": "Unknown occurrence action."}, status=status.HTTP_400_BAD_REQUEST)

        payload = SkipInputSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        record, streak, reward = skip_occurrence(
            occurrence_id=occurrence.pk, user=request.user, data=payload.validated_data
        )
        return Response(
            {
                "completion": CompletionRecordSerializer(record).data,
                "streak": StreakSerializer(streak).data,
                "reward": UserRewardSerializer(reward).data,
            },
            status=status.HTTP_201_CREATED,
        )


class CompletionRecordViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = CompletionRecordSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return CompletionRecord.objects.filter(
            occurrence__habit__user=self.request.user
        ).select_related("occurrence", "skip_reason")


class SkipReasonViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = SkipReasonSerializer
    permission_classes = [IsAuthenticated]
    queryset = SkipReason.objects.filter(is_active=True)


class ReminderViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = ReminderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Reminder.objects.filter(
            occurrence__habit__user=self.request.user
        ).select_related("occurrence", "occurrence__habit")

    def perform_destroy(self, instance):
        instance.status = Reminder.Status.CANCELLED
        instance.delivery_status = "cancelled_by_user"
        instance.save(update_fields=["status", "delivery_status"])


class UserRewardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        reward, _ = UserReward.objects.get_or_create(user=request.user)
        return Response(UserRewardSerializer(reward).data)
