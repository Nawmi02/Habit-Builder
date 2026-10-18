"""
Automatic points: whenever a COMPLETION_RECORD (entity 5) is saved or deleted,
points are given or taken back. The entity-5 teammate does not need to call
anything; the rules in services.py run on their own.
"""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from . import services

COMPLETION_MODEL = "tracking.CompletionRecord"   # lazy string: no import of the other app


@receiver(post_save, sender=COMPLETION_MODEL)
def completion_saved(sender, instance, **kwargs):
    if instance.completed_at:          # target reached -> habit is done
        services.on_habit_completed(instance)
    else:                              # completed_at cleared -> undo
        services.on_completion_undone(instance.occurrence)


@receiver(post_delete, sender=COMPLETION_MODEL)
def completion_deleted(sender, instance, **kwargs):
    # the completion's own points are already gone (CASCADE);
    # remove that day's daily bonus too, if the occurrence still exists
    occurrence_model = sender._meta.get_field("occurrence").related_model
    occurrence = occurrence_model.objects.filter(pk=instance.occurrence_id).select_related("habit__user").first()
    if occurrence is not None:
        services.on_completion_undone(occurrence)
