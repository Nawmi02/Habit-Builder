from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CompletionRecordViewSet,
    HabitViewSet,
    OccurrenceCompletionView,
    ReminderViewSet,
    SkipReasonViewSet,
    UserRewardView,
)

router = DefaultRouter()
router.register("habits", HabitViewSet, basename="habit")
router.register("completions", CompletionRecordViewSet, basename="completion")
router.register("skip-reasons", SkipReasonViewSet, basename="skip-reason")
router.register("reminders", ReminderViewSet, basename="reminder")

urlpatterns = [
    path("occurrences/<int:pk>/complete/", OccurrenceCompletionView.as_view(), {"action_name": "complete"}),
    path("occurrences/<int:pk>/skip/", OccurrenceCompletionView.as_view(), {"action_name": "skip"}),
    path("occurrences/<int:pk>/undo/", OccurrenceCompletionView.as_view(), {"action_name": "undo"}),
    path("rewards/me/", UserRewardView.as_view(), name="my-reward"),
    path("", include(router.urls)),
]
