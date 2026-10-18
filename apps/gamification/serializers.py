from rest_framework import serializers

from .models import Badge, PointTransaction, UserBadge


class PointTransactionSerializer(serializers.ModelSerializer):
    point_id = serializers.IntegerField(source="pk", read_only=True)
    user_id = serializers.IntegerField(read_only=True)
    completion_id = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = PointTransaction
        fields = [
            "point_id", "user_id", "completion_id",
            "related_type", "points", "reason", "created_at",
        ]
        read_only_fields = fields


class BadgeSerializer(serializers.ModelSerializer):
    """
    Badge catalogue + this user's status for each badge.
    Needs context: owned = {badge_id: unlocked_at}, values = {condition_type: current value}
    """

    badge_id = serializers.IntegerField(source="pk", read_only=True)
    unlocked = serializers.SerializerMethodField()
    unlocked_at = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()

    class Meta:
        model = Badge
        fields = [
            "badge_id", "code", "name", "description",
            "condition_type", "condition_value",
            "unlocked", "unlocked_at", "progress",
        ]
        read_only_fields = fields

    def get_unlocked(self, obj) -> bool:
        return obj.pk in self.context.get("owned", {})

    def get_unlocked_at(self, obj):
        value = self.context.get("owned", {}).get(obj.pk)
        return serializers.DateTimeField().to_representation(value) if value else None

    def get_progress(self, obj) -> int:
        """Current value towards the badge, capped at the goal (e.g. 4 of 7 days)."""
        if obj.pk in self.context.get("owned", {}):
            return obj.condition_value
        current = self.context.get("values", {}).get(obj.condition_type, 0)
        return min(current, obj.condition_value)


class UserBadgeSerializer(serializers.ModelSerializer):
    user_badge_id = serializers.IntegerField(source="pk", read_only=True)
    user_id = serializers.IntegerField(read_only=True)
    badge_id = serializers.IntegerField(read_only=True)
    code = serializers.CharField(source="badge.code", read_only=True)
    name = serializers.CharField(source="badge.name", read_only=True)
    description = serializers.CharField(source="badge.description", read_only=True)

    class Meta:
        model = UserBadge
        fields = [
            "user_badge_id", "user_id", "badge_id",
            "code", "name", "description", "unlocked_at",
        ]
        read_only_fields = fields
