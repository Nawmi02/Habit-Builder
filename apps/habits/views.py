from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Habit, HabitOccurrence
from .serializers import HabitSerializer, HabitOccurrenceSerializer


class HabitViewSet(viewsets.ModelViewSet):
    """
    Habit CRUD API.

    Endpoints:
    - GET    /api/habits/                 → list habits
    - POST   /api/habits/                 → create habit + schedule
    - GET    /api/habits/{id}/            → retrieve habit
    - PATCH  /api/habits/{id}/            → update habit
    - DELETE /api/habits/{id}/            → soft delete
    - POST   /api/habits/{id}/pause/      → pause
    - POST   /api/habits/{id}/resume/     → resume
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

    def perform_destroy(self, instance):
        """Soft delete: mark DELETED, don't remove row."""
        instance.status = Habit.Status.DELETED
        instance.save(update_fields=["status", "updated_at"])

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        """Pause a habit (optional `until` date)."""
        habit = self.get_object()
        until = request.data.get("until")

        habit.status = Habit.Status.PAUSED
        habit.save(update_fields=["status", "updated_at"])

        schedule = getattr(habit, "schedule", None)
        if schedule:
            schedule.pause_start = timezone.now().date()
            schedule.pause_end = until
            schedule.save(update_fields=["pause_start", "pause_end"])

        return Response(self.get_serializer(habit).data)

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        """Resume a paused habit."""
        habit = self.get_object()

        habit.status = Habit.Status.ACTIVE
        habit.save(update_fields=["status", "updated_at"])

        schedule = getattr(habit, "schedule", None)
        if schedule:
            schedule.pause_end = timezone.now().date()
            schedule.save(update_fields=["pause_end"])

        return Response(self.get_serializer(habit).data)

    @action(detail=True, methods=["get"])
    def occurrences(self, request, pk=None):
        """List occurrences for a habit (with optional date range)."""
        habit = self.get_object()
        qs = habit.occurrences.all()

        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")
        if from_date and to_date:
            qs = qs.filter(scheduled_date__range=[from_date, to_date])

        serializer = HabitOccurrenceSerializer(qs, many=True)
        return Response(serializer.data)