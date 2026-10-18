from datetime import date, timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from apps.users.models import User

from .models import (
    CompletionRecord,
    Habit,
    HabitOccurrence,
    Reminder,
    SkipReason,
    Streak,
    UserReward,
)
from .progress import mark_occurrence_missed


class HabitProgressApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="habit-user@example.com",
            password="test-password-123",
            name="Habit User",
        )
        self.client.force_authenticate(self.user)

    def make_habit(self, *, habit_type=Habit.HabitType.GOOD, name="Read"):
        return Habit.objects.create(
            user=self.user,
            name=name,
            habit_type=habit_type,
            start_date=date.today(),
        )

    def make_occurrence(self, habit, *, scheduled_date=None, deadline_at=None):
        scheduled_date = scheduled_date or date.today()
        deadline_at = deadline_at or timezone.now() + timedelta(hours=1)
        return HabitOccurrence.objects.create(
            habit=habit,
            scheduled_date=scheduled_date,
            deadline_at=deadline_at,
        )

    def test_completing_good_habit_increments_streak_and_rewards(self):
        habit = self.make_habit()
        occurrence = self.make_occurrence(habit)

        response = self.client.post(
            f"/api/occurrences/{occurrence.pk}/complete/",
            {"progress_value": 1, "mood": "good"},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(occurrence.__class__.objects.get(pk=occurrence.pk).status, "COMPLETED")
        self.assertEqual(Streak.objects.get(habit=habit).current_streak, 1)
        self.assertEqual(UserReward.objects.get(user=self.user).total_points, 10)
        self.assertTrue(CompletionRecord.objects.filter(occurrence=occurrence).exists())

    def test_skipping_bad_habit_builds_streak_and_lapse_reduces_it(self):
        habit = self.make_habit(habit_type=Habit.HabitType.BAD, name="Smoke")
        first_day = date.today()
        avoid = self.make_occurrence(habit, scheduled_date=first_day)

        response = self.client.post(
            f"/api/occurrences/{avoid.pk}/skip/", {}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Streak.objects.get(habit=habit).current_streak, 1)
        self.assertEqual(UserReward.objects.get(user=self.user).total_points, 10)

        lapse = self.make_occurrence(habit, scheduled_date=first_day + timedelta(days=1))
        response = self.client.post(
            f"/api/occurrences/{lapse.pk}/complete/", {}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Streak.objects.get(habit=habit).current_streak, 0)
        self.assertEqual(UserReward.objects.get(user=self.user).total_points, 10)

    def test_one_good_habit_skip_decreases_streak_by_one(self):
        habit = self.make_habit()
        yesterday = date.today() - timedelta(days=1)
        Streak.objects.create(
            habit=habit, current_streak=5, best_streak=5, last_completed_date=yesterday
        )
        occurrence = self.make_occurrence(habit)
        reason = SkipReason.objects.get(name="Busy")

        response = self.client.post(
            f"/api/occurrences/{occurrence.pk}/skip/",
            {"skip_reason_id": reason.pk},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Streak.objects.get(habit=habit).current_streak, 4)
        self.assertEqual(UserReward.objects.get(user=self.user).total_points, 0)

    def test_completing_occurrence_cancels_its_pending_reminder(self):
        habit = self.make_habit()
        occurrence = self.make_occurrence(habit)
        reminder = Reminder.objects.create(
            occurrence=occurrence,
            reminder_type=Reminder.Type.PUSH,
            scheduled_at=timezone.now() + timedelta(minutes=5),
        )

        response = self.client.post(
            f"/api/occurrences/{occurrence.pk}/complete/", {}, format="json"
        )

        self.assertEqual(response.status_code, 201, response.data)
        reminder.refresh_from_db()
        self.assertEqual(reminder.status, Reminder.Status.CANCELLED)

    def test_skip_reason_endpoint_lists_seeded_reasons(self):
        response = self.client.get("/api/skip-reasons/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Busy", {item["name"] for item in response.data["results"]})

    def test_missed_occurrence_after_a_week_resets_streak(self):
        habit = self.make_habit()
        today = date.today()
        Streak.objects.create(
            habit=habit,
            current_streak=5,
            best_streak=8,
            last_completed_date=today - timedelta(days=7),
        )
        occurrence = self.make_occurrence(
            habit,
            scheduled_date=today,
            deadline_at=timezone.now() - timedelta(minutes=1),
        )

        self.assertTrue(mark_occurrence_missed(occurrence.pk))
        self.assertEqual(Streak.objects.get(habit=habit).current_streak, 0)
        self.assertEqual(
            HabitOccurrence.objects.get(pk=occurrence.pk).status,
            HabitOccurrence.Status.MISSED,
        )
