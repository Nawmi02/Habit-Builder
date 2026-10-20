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


class HabitIntegrationTests(APITestCase):
    """Entity 5-9 (this app) working together with entity 10-13 (gamification, devices)."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="flow-user@example.com", password="test-password-123", name="Flow User"
        )
        self.client.force_authenticate(self.user)

    def make_daily_habit(self, name="Read", habit_type=Habit.HabitType.GOOD):
        from .models import HabitSchedule

        habit = Habit.objects.create(
            user=self.user, name=name, habit_type=habit_type, start_date=date.today()
        )
        HabitSchedule.objects.create(habit=habit, frequency_type=HabitSchedule.FrequencyType.DAILY)
        return habit

    def make_occurrence(self, habit, deadline_at=None):
        return HabitOccurrence.objects.create(
            habit=habit,
            scheduled_date=date.today(),
            deadline_at=deadline_at or timezone.now() + timedelta(hours=2),
        )

    def test_reward_includes_daily_bonus_and_matches_points(self):
        occurrence = self.make_occurrence(self.make_daily_habit())

        response = self.client.post(f"/api/occurrences/{occurrence.pk}/complete/", {}, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["reward"]["total_points"], 10 + 20)
        summary = self.client.get("/api/points/summary/").data
        self.assertEqual(summary["total_points"], response.data["reward"]["total_points"])

    def test_seventh_day_streak_gives_bonus_and_badge(self):
        from apps.gamification.models import PointTransaction, UserBadge

        habit = self.make_daily_habit()
        Streak.objects.create(
            habit=habit, current_streak=6, best_streak=6,
            last_completed_date=date.today() - timedelta(days=1),
        )
        occurrence = self.make_occurrence(habit)

        response = self.client.post(f"/api/occurrences/{occurrence.pk}/complete/", {}, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["streak"]["current_streak"], 7)
        self.assertTrue(PointTransaction.objects.filter(user=self.user, related_type="STREAK", points=50).exists())
        self.assertTrue(UserBadge.objects.filter(user=self.user, badge__code="streak-7").exists())
        self.assertEqual(UserReward.objects.get(user=self.user).total_points, 10 + 20 + 50)

    def test_undo_takes_back_points_and_streak(self):
        habit = self.make_daily_habit()
        occurrence = self.make_occurrence(habit)
        self.client.post(f"/api/occurrences/{occurrence.pk}/complete/", {}, format="json")

        response = self.client.post(f"/api/occurrences/{occurrence.pk}/undo/", {}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["occurrence"]["status"], "PENDING")
        self.assertEqual(response.data["streak"]["current_streak"], 0)
        self.assertEqual(response.data["reward"]["total_points"], 0)
        self.assertFalse(CompletionRecord.objects.filter(occurrence=occurrence).exists())

        # it can be completed again after the undo
        again = self.client.post(f"/api/occurrences/{occurrence.pk}/complete/", {}, format="json")
        self.assertEqual(again.status_code, 201, again.data)

    def test_undo_after_deadline_is_rejected(self):
        occurrence = self.make_occurrence(
            self.make_daily_habit(), deadline_at=timezone.now() - timedelta(minutes=1)
        )
        self.client.post(f"/api/occurrences/{occurrence.pk}/complete/", {}, format="json")

        response = self.client.post(f"/api/occurrences/{occurrence.pk}/undo/", {}, format="json")

        self.assertEqual(response.status_code, 400)

    def test_undo_pending_occurrence_is_rejected(self):
        occurrence = self.make_occurrence(self.make_daily_habit())
        response = self.client.post(f"/api/occurrences/{occurrence.pk}/undo/", {}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_weekly_habit_gets_one_occurrence_per_slot(self):
        from .models import HabitSchedule
        from .services import _user_today, generate_occurrences

        today = _user_today(self.user)
        monday = today - timedelta(days=today.weekday())
        habit = Habit.objects.create(user=self.user, name="Gym", start_date=monday)
        HabitSchedule.objects.create(
            habit=habit, frequency_type=HabitSchedule.FrequencyType.TIMES_PER_WEEK, times_per_week=3
        )

        generate_occurrences(habit)

        this_week = habit.occurrences.filter(
            scheduled_date__range=(monday, monday + timedelta(days=6))
        )
        self.assertEqual(this_week.count(), 3)
        self.assertEqual(len({occ.deadline_at for occ in this_week}), 1)   # all due on Sunday

    def test_logout_revokes_refresh_token(self):
        self.client.force_authenticate(None)
        login = self.client.post(
            "/api/auth/login/",
            {"email": "flow-user@example.com", "password": "test-password-123"},
            format="json",
        )
        refresh = login.data["refresh"]

        logout = self.client.post("/api/auth/logout/", {"refresh": refresh}, format="json")
        self.assertEqual(logout.status_code, 200)

        reuse = self.client.post("/api/auth/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(reuse.status_code, 401)
