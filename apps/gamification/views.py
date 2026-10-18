from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import services
from .models import Badge, PointTransaction, UserBadge
from .serializers import BadgeSerializer, PointTransactionSerializer, UserBadgeSerializer


class PointTransactionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    POINT_TRANSACTION (entity 10) - read only. Points are created by services.py.

    - GET /api/points/                      -> my point history (newest first)
    - GET /api/points/?related_type=STREAK  -> filter by type
    - GET /api/points/{point_id}/           -> one transaction
    - GET /api/points/summary/              -> total points, level, progress
    """

    serializer_class = PointTransactionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):   # Swagger schema generation
            return PointTransaction.objects.none()
        qs = PointTransaction.objects.filter(user=self.request.user)   # NFR-10
        related_type = self.request.query_params.get("related_type")
        if related_type:
            qs = qs.filter(related_type=related_type.upper())
        return qs

    @extend_schema(parameters=[OpenApiParameter("related_type", str, enum=PointTransaction.RelatedType.values)])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        return Response(services.progress_summary(request.user))


class BadgeViewSet(viewsets.ReadOnlyModelViewSet):
    """
    BADGE (entity 11) + USER_BADGE (entity 12).
    Badges are added/edited by admins in Django admin, not through the API.

    - GET /api/badges/                -> all badges with unlocked / progress for me
    - GET /api/badges/{badge_id}/     -> one badge
    - GET /api/badges/mine/           -> only the badges I have unlocked
    """

    serializer_class = BadgeSerializer
    permission_classes = [IsAuthenticated]
    queryset = Badge.objects.all()
    pagination_class = None   # the catalogue is small

    def get_serializer_context(self):
        context = super().get_serializer_context()
        user = getattr(self.request, "user", None)
        if user is not None and user.is_authenticated:
            context["owned"] = dict(
                UserBadge.objects.filter(user=user).values_list("badge_id", "unlocked_at")
            )
            context["values"] = services.badge_progress_values(user)
        return context

    @extend_schema(responses=UserBadgeSerializer(many=True))
    @action(detail=False, methods=["get"])
    def mine(self, request):
        qs = UserBadge.objects.filter(user=request.user).select_related("badge")
        return Response(UserBadgeSerializer(qs, many=True).data)
