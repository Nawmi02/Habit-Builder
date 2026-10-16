from collections import defaultdict
from datetime import date
from zoneinfo import ZoneInfo

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Habit, HabitOccurrence
from .serializers import (
    HabitSerializer,
    HabitOccurrenceSerializer,
    HabitOccurrenceDetailSerializer,
)
from .services import generate_occurrences, remove_future_pending


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
        qs = habit.occurrences.all().order_by("scheduled_date")

        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")
        if from_date and to_date:
            qs = qs.filter(scheduled_date__range=[from_date, to_date])

        serializer = HabitOccurrenceSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"])
    def checklist(self, request):
        """Today's checklist grouped by time_of_day."""
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