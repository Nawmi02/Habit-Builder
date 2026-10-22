from zoneinfo import available_timezones

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import User, DeviceToken


class UserSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="pk", read_only=True)

    class Meta:
        model = User
        fields = [
            "user_id", "name", "email", "time_zone",
            "notifications_enabled", "theme", "created_at",
        ]
        read_only_fields = ["user_id", "created_at"]


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["email", "name", "password", "time_zone"]

    def validate_time_zone(self, value):
        if value not in available_timezones():
            raise serializers.ValidationError("Unknown time zone.")
        return value

    def validate_password(self, value):
        candidate = User(
            email=self.initial_data.get("email", ""),
            name=self.initial_data.get("name", ""),
        )
        try:
            validate_password(value, user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class DeviceTokenSerializer(serializers.ModelSerializer):
    device_id = serializers.IntegerField(source="pk", read_only=True)
    user_id = serializers.IntegerField(source="user.pk", read_only=True)
    # Declared by hand so DRF does not add a UniqueValidator: the same phone
    # must be able to register its token again (the view updates the row).
    push_token = serializers.CharField(max_length=255)

    class Meta:
        model = DeviceToken
        fields = ["device_id", "user_id", "push_token", "platform", "last_active"]
        read_only_fields = ["device_id", "user_id", "last_active"]

class DeviceTokenUnregisterSerializer(serializers.Serializer):
    push_token = serializers.CharField(max_length=255)


