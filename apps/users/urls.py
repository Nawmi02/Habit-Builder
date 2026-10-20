from django.urls import path
from rest_framework.routers import SimpleRouter
from rest_framework_simplejwt.views import (
    TokenBlacklistView,
    TokenObtainPairView,
    TokenRefreshView,
)

from .views import DeviceTokenViewSet, MeView, RegisterView

router = SimpleRouter()
router.register("devices", DeviceTokenViewSet, basename="device")

urlpatterns = [
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/login/", TokenObtainPairView.as_view(), name="login"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="refresh"),
    # logout: send {"refresh": "..."}; that refresh token can no longer be used
    path("auth/logout/", TokenBlacklistView.as_view(), name="logout"),
    path("users/me/", MeView.as_view(), name="me"),
] + router.urls