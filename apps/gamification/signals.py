"""
Automatic points: whenever a COMPLETION_RECORD (entity 5) is saved or deleted,
points are given or taken back. The entity-5 code does not need to call
anything; the rules in services.py run on their own.

COMPLETION_RECORD has two model classes that share one table:
- habits.CompletionRecord   (the real model, entity-5 teammate)
- tracking.CompletionRecord (a proxy used by POINT_TRANSACTION and progress.py)
Django sends a save/delete signal only for the class that was used, so both are
listened to. Each save still runs the rules exactly once.
"""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from . import services

COMPLETION_MODELS = ("tracking.CompletionRecord", "habits.CompletionRecord")


def _completion_saved(sender, instance, **kwargs):
    services.on_completion_saved(instance)


def _completion_deleted(sender, instance, **kwargs):
    # the completion's own points are already gone (CASCADE);
    # remove that day's daily bonus too, if the occurrence still exists
    occurrence_model = sender._meta.get_field("occurrence").related_model
    occurrence = (
        occurrence_model.objects.filter(pk=instance.occurrence_id)
        .select_related("habit__user")
        .first()
    )
    if occurrence is not None:
        services.on_completion_undone(occurrence)


for _label in COMPLETION_MODELS:
    receiver(post_save, sender=_label, dispatch_uid=f"gamification_saved_{_label}")(_completion_saved)
    receiver(post_delete, sender=_label, dispatch_uid=f"gamification_deleted_{_label}")(_completion_deleted)
