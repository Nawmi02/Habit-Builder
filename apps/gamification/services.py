"""
Points, levels and badges (FR-18, business rule 11.7).

Views never change points directly; everything goes through these functions,
so the API, signals and other teammates' code all follow the same rules.

Who calls what:
- Completion saved / deleted ........ signals.py calls on_completion_saved / on_completion_undone
- STREAK teammate (entity 7) ........ on_streak_updated(habit, current_streak, day)
- REMINDER teammate (entity 8) ...... uses the `new_badges` list to send "badge unlocked" pushes
"""

from django.apps import apps
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Max, Q, Sum

from .models import Badge, PointTransaction, UserBadge

RT = PointTransaction.RelatedType

# Default rules. Override any of them in settings.GAMIFICATION = {...}
_DEFAULTS = {
    "COMPLETION_POINTS": 10,                # PRD 18: complete a habit -> +10 XP
    "DAILY_BONUS_POINTS": 20,               # PRD 18: complete all daily habits -> bonus
    "STREAK_MILESTONES": {7: 50, 30: 150},  # PRD 18: streak rewards
    "BADGE_POINTS": 0,                      # the badge itself is the reward
    "POINTS_PER_LEVEL": 100,                # 0-99 = level 1, 100-199 = level 2 ...
}


def cfg(key):
    return getattr(settings, "GAMIFICATION", {}).get(key, _DEFAULTS[key])


# --------------------------------------------------------------------------
# Reading points and level
# --------------------------------------------------------------------------

def total_points(user) -> int:
    return user.point_transactions.aggregate(s=Sum("points"))["s"] or 0


def checkin_count(user) -> int:
    """How many habits the user has completed (one COMPLETION row each)."""
    return user.point_transactions.filter(related_type=RT.COMPLETION).count()


def level_for(points: int) -> int:
    return max(points, 0) // cfg("POINTS_PER_LEVEL") + 1


def progress_summary(user) -> dict:
    points = total_points(user)
    level = level_for(points)
    next_level_at = level * cfg("POINTS_PER_LEVEL")
    return {
        "total_points": points,
        "level": level,
        "next_level_at": next_level_at,
        "points_to_next_level": next_level_at - max(points, 0),
        "checkins": checkin_count(user),
        "badges_unlocked": user.user_badges.count(),
    }


# --------------------------------------------------------------------------
# Links to other teammates' models (looked up by name, so this app still
# works before those models exist)
# --------------------------------------------------------------------------

def _get_model(setting_name):
    label = getattr(settings, setting_name, None)   # e.g. "rewards.UserReward"
    if not label:
        return None
    try:
        return apps.get_model(label)
    except (LookupError, ValueError):
        return None


def _sync_user_reward(user):
    """Keep USER_REWARD (entity 9) total_points/level equal to the transactions."""
    UserReward = _get_model("USER_REWARD_MODEL")
    if UserReward is None:
        return
    points = total_points(user)
    UserReward.objects.update_or_create(
        user=user,
        defaults={"total_points": points, "level": level_for(points)},
    )


def best_current_streak(user) -> int:
    """Highest current_streak among the user's habits (STREAK, entity 7)."""
    Streak = _get_model("STREAK_MODEL")
    if Streak is None:
        return 0
    return Streak.objects.filter(habit__user=user).aggregate(m=Max("current_streak"))["m"] or 0


def badge_progress_values(user, current_streak=None) -> dict:
    """The user's current value for every badge condition type."""
    return {
        Badge.ConditionType.TOTAL_CHECKINS.value: checkin_count(user),
        Badge.ConditionType.TOTAL_POINTS.value: total_points(user),
        Badge.ConditionType.STREAK_DAYS.value: max(current_streak or 0, best_current_streak(user)),
    }


# --------------------------------------------------------------------------
# Giving points
# --------------------------------------------------------------------------

def _daily_bonus_reason(day) -> str:
    return f"All habits completed on {day.isoformat()}"


def _give_bonus(user, related_type, points, reason):
    """Create a bonus row once. The unique (user, reason) constraint blocks repeats."""
    if points <= 0:
        return None
    try:
        with transaction.atomic():
            return PointTransaction.objects.create(
                user=user, related_type=related_type, points=points, reason=reason
            )
    except IntegrityError:
        return None   # already given earlier


def _positive_q():
    """An occurrence handled the good way: a good habit done, or a bad habit avoided."""
    return Q(habit__habit_type="GOOD", status="COMPLETED") | Q(habit__habit_type="BAD", status="SKIPPED")


def _resolved_q():
    """An occurrence that no longer blocks the daily bonus (positive, or a good habit skipped)."""
    return _positive_q() | Q(habit__habit_type="GOOD", status="SKIPPED")


def award_daily_bonus_if_earned(user, day, just_completed_id=None, just_completed_positive=True):
    """
    Bonus when every daily/weekday habit scheduled on `day` is resolved and at
    least one of them was handled the good way.

    `just_completed_id` is the occurrence being completed or skipped right now;
    its new status is saved a moment later, so it is passed in instead of read.
    """
    Habit = apps.get_model("habits", "Habit")
    HabitOccurrence = apps.get_model("habits", "HabitOccurrence")

    todays = HabitOccurrence.objects.filter(
        habit__user=user,
        habit__status=Habit.Status.ACTIVE,
        habit__schedule__frequency_type__in=["DAILY", "WEEKDAYS"],
        scheduled_date=day,
    )
    has_positive = False
    if just_completed_id:
        todays = todays.exclude(pk=just_completed_id)
        has_positive = bool(just_completed_positive)
    has_positive = has_positive or todays.filter(_positive_q()).exists()

    not_done = todays.exclude(_resolved_q()).exists()
    if not_done or not has_positive:
        return None
    return _give_bonus(user, RT.DAILY_BONUS, cfg("DAILY_BONUS_POINTS"), _daily_bonus_reason(day))


def check_badges(user, current_streak=None) -> list:
    """Unlock every badge whose condition is now met. Returns the new UserBadge rows."""
    values = badge_progress_values(user, current_streak)
    owned = UserBadge.objects.filter(user=user).values_list("badge_id", flat=True)

    new_badges = []
    for badge in Badge.objects.exclude(id__in=owned):
        if values.get(badge.condition_type, 0) < badge.condition_value:
            continue
        user_badge, created = UserBadge.objects.get_or_create(user=user, badge=badge)
        if created:
            new_badges.append(user_badge)
            _give_bonus(user, RT.BADGE, cfg("BADGE_POINTS"), f"Badge unlocked: {badge.name}")
    return new_badges


def _is_day_based(habit) -> bool:
    schedule = getattr(habit, "schedule", None)
    return schedule is not None and schedule.frequency_type in ("DAILY", "WEEKDAYS")


@transaction.atomic
def on_habit_completed(completion, current_streak=None) -> dict:
    """
    Give points for a positive action on one occurrence: a good habit completed,
    or a bad habit avoided. Safe to call more than once: points are given once.
    """
    occurrence = completion.occurrence
    habit = occurrence.habit
    user = habit.user
    before = total_points(user)

    PointTransaction.objects.get_or_create(
        completion=completion,
        defaults={
            "user": user,
            "related_type": RT.COMPLETION,
            "points": cfg("COMPLETION_POINTS"),
            "reason": (f"Avoided {habit.name}" if habit.habit_type == "BAD" else f"Completed {habit.name}")[:255],
        },
    )
    # daily bonus only for day-based habits; a "3 times a week" occurrence must
    # not trigger a day's bonus
    if _is_day_based(habit):
        award_daily_bonus_if_earned(user, occurrence.scheduled_date, just_completed_id=occurrence.pk)
    new_badges = check_badges(user, current_streak)
    _sync_user_reward(user)

    return {
        "points_earned": total_points(user) - before,
        "new_badges": new_badges,
        **progress_summary(user),
    }


@transaction.atomic
def on_good_habit_skipped(occurrence) -> None:
    """
    A good habit was skipped (with a reason). It earns no points, but it no longer
    blocks the daily bonus, so check the bonus again.
    """
    if _is_day_based(occurrence.habit):
        award_daily_bonus_if_earned(
            occurrence.habit.user,
            occurrence.scheduled_date,
            just_completed_id=occurrence.pk,
            just_completed_positive=False,
        )
        _sync_user_reward(occurrence.habit.user)


def on_completion_saved(record) -> None:
    """
    Decide what a saved COMPLETION_RECORD means and apply the point rules.

    | habit | completed_at | meaning                         |
    | GOOD  | set          | done -> +points                 |
    | GOOD  | empty        | skipped, or completion cleared  |
    | BAD   | empty        | avoided (a skip) -> +points     |
    | BAD   | set          | slipped -> no points            |
    """
    occurrence = record.occurrence
    is_bad = occurrence.habit.habit_type == "BAD"
    positive = (record.completed_at is None) if is_bad else (record.completed_at is not None)
    had_points = PointTransaction.objects.filter(completion_id=record.pk).exists()

    if positive:
        on_habit_completed(record)
    elif had_points:
        on_completion_undone(occurrence)      # an earlier positive result was changed
    elif not is_bad:
        on_good_habit_skipped(occurrence)


@transaction.atomic
def on_completion_undone(occurrence) -> None:
    """
    Call when a completion is undone (FR-08). Removes its points and that day's
    daily bonus. Badges already unlocked are kept.
    """
    user = occurrence.habit.user
    PointTransaction.objects.filter(completion__occurrence=occurrence).delete()
    PointTransaction.objects.filter(
        user=user,
        related_type=RT.DAILY_BONUS,
        reason=_daily_bonus_reason(occurrence.scheduled_date),
    ).delete()
    _sync_user_reward(user)


@transaction.atomic
def on_streak_updated(habit, current_streak, day) -> dict:
    """
    STREAK teammate (entity 7) calls this after recalculating a habit's streak.
    Gives the 7 / 30-day milestone bonus once per milestone per day and
    unlocks streak badges.
    """
    user = habit.user
    before = total_points(user)

    milestone_points = cfg("STREAK_MILESTONES").get(current_streak)
    if milestone_points:
        _give_bonus(
            user,
            RT.STREAK,
            milestone_points,
            f"{current_streak}-day streak on {habit.name} (habit {habit.pk}) - {day.isoformat()}"[:255],
        )
    new_badges = check_badges(user, current_streak)
    _sync_user_reward(user)

    return {
        "points_earned": total_points(user) - before,
        "new_badges": new_badges,
        **progress_summary(user),
    }
