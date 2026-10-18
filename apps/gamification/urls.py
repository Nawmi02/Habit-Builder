from rest_framework.routers import SimpleRouter

from .views import BadgeViewSet, PointTransactionViewSet

router = SimpleRouter()
router.register("points", PointTransactionViewSet, basename="point")
router.register("badges", BadgeViewSet, basename="badge")

urlpatterns = router.urls
