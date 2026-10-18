from django.apps import AppConfig


class GamificationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.gamification"
    label = "gamification"

    def ready(self):
        # connect signal handlers (completion saved / deleted -> points)
        from . import signals  # noqa: F401
