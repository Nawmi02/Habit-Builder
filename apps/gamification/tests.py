"""
Tests for ER entities 10-12 (POINT_TRANSACTION, BADGE, USER_BADGE).

Run:  python manage.py test apps.gamification
"""

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.habits.models import Habit, HabitOccurrence, HabitSchedule
from apps.tracking.models import CompletionRecord

from . import services
from .models import Badge, PointTransaction, UserBadge

User = get_user_model()
RT = PointTransaction.RelatedType


def make_user(email="a@x.com"):
    return User.objects.create_user(email=email, password="pass12345", name="A")


def make_habit(user, name="Read", freq="DAILY"):
    habit = Habit.objects.create(user=user, name=name, start_date=date.today())
    HabitSchedule.objects.create(habit=habit, frequency_type=freq)
    return habit


def make_occurrence(habit, day=None):
    day = day or date.today()
    return HabitOccurrence.objects.create(
        habit=habit, scheduled_date=day, deadline_at=timezone.now() + timedelta(hours=5)
    )


def complete(occurrence):
    """What the entity-5 code does: mark done + save a completion record."""
    occurrence.status = HabitOccurrence.Status.COMPLETED
    occurrence.save(update_fields=["status"])
    return CompletionRecord.objects.create(
        occurrence=occurrence, progress_value=1, completed_at=timezone.now()
    )


class PointRulesTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.read = make_habit(self.user, "Read")
        self.water = make_habit(self.user, "Water")

    def test_completion_gives_10_points_once(self):
        record = complete(make_occurrence(self.read))
        services.on_habit_completed(record)          # called twice on purpose
        rows = PointTransaction.objects.filter(user=self.user, related_type=RT.COMPLETION)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().points, 10)
        self.assertEqual(rows.get().completion, record)

    def test_daily_bonus_only_when_all_done(self):
        read_today, water_today = make_occurrence(self.read), make_occurrence(self.water)
        complete(read_today)
        self.assertFalse(PointTransaction.objects.filter(related_type=RT.DAILY_BONUS).exists())

        complete(water_today)
        bonus = PointTransaction.objects.filter(related_type=RT.DAILY_BONUS)
        self.assertEqual(bonus.count(), 1)
        self.assertIsNone(bonus.get().completion)    # bonus has no completion (nullable FK)
        self.assertEqual(services.total_points(self.user), 10 + 10 + 20)

    def test_skipped_habit_does_not_block_daily_bonus(self):
        skipped = make_occurrence(self.water)
        skipped.status = HabitOccurrence.Status.SKIPPED
        skipped.save()
        complete(make_occurrence(self.read))
        self.assertTrue(PointTransaction.objects.filter(related_type=RT.DAILY_BONUS).exists())

    def test_weekly_habit_does_not_give_daily_bonus(self):
        gym = make_habit(self.user, "Gym", freq="TIMES_PER_WEEK")
        gym.schedule.times_per_week = 3
        gym.schedule.save()
        complete(make_occurrence(gym))
        self.assertFalse(PointTransaction.objects.filter(related_type=RT.DAILY_BONUS).exists())

    def test_undo_removes_points_and_daily_bonus(self):
        read_today, water_today = make_occurrence(self.read), make_occurrence(self.water)
        complete(read_today)
        record = complete(water_today)
        self.assertEqual(services.total_points(self.user), 40)

        record.delete()                              # undo (FR-08)
        self.assertEqual(services.total_points(self.user), 10)
        self.assertFalse(PointTransaction.objects.filter(related_type=RT.DAILY_BONUS).exists())

    def test_undo_by_clearing_completed_at(self):
        record = complete(make_occurrence(self.read))
        record.completed_at = None
        record.save()
        self.assertEqual(services.total_points(self.user), 0)

    def test_progress_without_completion_gives_nothing(self):
        CompletionRecord.objects.create(occurrence=make_occurrence(self.read), progress_value=3)
        self.assertEqual(services.total_points(self.user), 0)

    def test_streak_milestone_bonus_once(self):
        services.on_streak_updated(self.read, 7, date.today())
        services.on_streak_updated(self.read, 7, date.today())   # same day again
        rows = PointTransaction.objects.filter(related_type=RT.STREAK)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().points, 50)

    def test_no_bonus_for_non_milestone_streak(self):
        services.on_streak_updated(self.read, 5, date.today())
        self.assertFalse(PointTransaction.objects.filter(related_type=RT.STREAK).exists())

    def test_level(self):
        self.assertEqual(services.level_for(0), 1)
        self.assertEqual(services.level_for(99), 1)
        self.assertEqual(services.level_for(100), 2)
        self.assertEqual(services.level_for(250), 3)

    @override_settings(GAMIFICATION={"COMPLETION_POINTS": 25})
    def test_rules_come_from_settings(self):
        record = complete(make_occurrence(self.read))
        self.assertEqual(record.point_transaction.points, 25)


class BadgeTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.habit = make_habit(self.user)

    def test_seeded_badges_exist(self):
        self.assertTrue(Badge.objects.filter(code="streak-7").exists())
        self.assertTrue(Badge.objects.filter(code="checkins-100").exists())

    def test_first_checkin_badge_unlocks(self):
        complete(make_occurrence(self.habit))
        self.assertTrue(UserBadge.objects.filter(user=self.user, badge__code="first-checkin").exists())

    def test_streak_badge_unlocks_once(self):
        result = services.on_streak_updated(self.habit, 7, date.today())
        self.assertIn("streak-7", [ub.badge.code for ub in result["new_badges"]])
        result = services.on_streak_updated(self.habit, 8, date.today())
        self.assertEqual(result["new_badges"], [])
        self.assertEqual(UserBadge.objects.filter(user=self.user, badge__code="streak-7").count(), 1)


class DatabaseConstraintTests(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_completion_type_needs_completion(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            PointTransaction.objects.create(
                user=self.user, related_type=RT.COMPLETION, points=10, reason="x"
            )

    def test_same_bonus_reason_blocked(self):
        PointTransaction.objects.create(user=self.user, related_type=RT.BADGE, points=5, reason="r")
        with self.assertRaises(IntegrityError), transaction.atomic():
            PointTransaction.objects.create(user=self.user, related_type=RT.BADGE, points=5, reason="r")

    def test_user_badge_unique(self):
        badge = Badge.objects.get(code="streak-7")
        UserBadge.objects.create(user=self.user, badge=badge)
        with self.assertRaises(IntegrityError), transaction.atomic():
            UserBadge.objects.create(user=self.user, badge=badge)


class GamificationApiTests(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.other = make_user("b@x.com")
        self.client.force_authenticate(self.user)
        complete(make_occurrence(make_habit(self.user)))
        complete(make_occurrence(make_habit(self.other)))

    def test_points_list_only_mine(self):
        res = self.client.get("/api/points/")
        self.assertEqual(res.status_code, 200)
        user_ids = {row["user_id"] for row in res.data["results"]}
        self.assertEqual(user_ids, {self.user.pk})

    def test_points_filter_by_type(self):
        res = self.client.get("/api/points/?related_type=completion")
        self.assertTrue(all(r["related_type"] == "COMPLETION" for r in res.data["results"]))

    def test_points_summary(self):
        res = self.client.get("/api/points/summary/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["total_points"], 30)   # 10 completion + 20 daily bonus
        self.assertEqual(res.data["level"], 1)
        self.assertEqual(res.data["points_to_next_level"], 70)
        self.assertEqual(res.data["checkins"], 1)

    def test_other_users_point_is_404(self):
        other_point = PointTransaction.objects.filter(user=self.other).first()
        res = self.client.get(f"/api/points/{other_point.pk}/")
        self.assertEqual(res.status_code, 404)

    def test_badges_show_unlocked_and_progress(self):
        res = self.client.get("/api/badges/")
        self.assertEqual(res.status_code, 200)
        by_code = {b["code"]: b for b in res.data}
        self.assertTrue(by_code["first-checkin"]["unlocked"])
        self.assertIsNotNone(by_code["first-checkin"]["unlocked_at"])
        self.assertFalse(by_code["checkins-100"]["unlocked"])
        self.assertEqual(by_code["checkins-100"]["progress"], 1)

    def test_my_badges(self):
        res = self.client.get("/api/badges/mine/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([b["code"] for b in res.data], ["first-checkin"])

    def test_badges_are_read_only(self):
        res = self.client.post("/api/badges/", {"code": "hack", "name": "x"})
        self.assertEqual(res.status_code, 405)

    def test_login_required(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/points/").status_code, 401)
        self.assertEqual(self.client.get("/api/badges/").status_code, 401)
