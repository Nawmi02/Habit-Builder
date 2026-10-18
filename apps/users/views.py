from drf_spectacular.utils import extend_schema
from rest_framework import generics, mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .models import DeviceToken
from .serializers import (
    DeviceTokenSerializer,
    DeviceTokenUnregisterSerializer,
    RegisterSerializer,
    UserSerializer,
)


def get_tokens_for_user(user):
    refresh = RefreshToken.for_user(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    }


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {
                "user": UserSerializer(user).data,
                **get_tokens_for_user(user),
            },
            status=status.HTTP_201_CREATED,
        )


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user


class DeviceTokenViewSet(
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    DEVICE_TOKEN (ER entity 13)

    - GET    /api/devices/                -> my registered devices
    - POST   /api/devices/                -> register or refresh this phone's token
    - DELETE /api/devices/{device_id}/    -> remove a device
    - POST   /api/devices/unregister/     -> remove by push_token (used on logout)
    """

    serializer_class = DeviceTokenSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return DeviceToken.objects.none()
        return DeviceToken.objects.filter(user=self.request.user)   # NFR-10

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # same token again (or from another account on this phone) -> update the row
        device, created = DeviceToken.objects.update_or_create(
            push_token=serializer.validated_data["push_token"],
            defaults={
                "user": request.user,
                "platform": serializer.validated_data["platform"],
            },
        )
        return Response(
            self.get_serializer(device).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @extend_schema(request=DeviceTokenUnregisterSerializer, responses={204: None})
    @action(detail=False, methods=["post"])
    def unregister(self, request):
        serializer = DeviceTokenUnregisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        DeviceToken.objects.filter(
            user=request.user,
            push_token=serializer.validated_data["push_token"],
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
