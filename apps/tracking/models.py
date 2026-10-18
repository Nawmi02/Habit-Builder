"""
ER entity 5: COMPLETION_RECORD  -- MINIMAL STARTER (owned by the entity-5 teammate)

Only the fields that POINT_TRANSACTION (entity 10) needs are here, so entity 10
can have a real foreign key today.

Entity-5 teammate: keep this app (label "tracking") and this model name, and
ADD the remaining ER fields (source, note, mood, skip_reason, synced_at) in a
new migration (0002_...). Do not delete 0001_initial.
"""

from django.db import models


class CompletionRecord(models.Model):
    """
    ER entity 5: COMPLETION_RECORD

    completion_id (PK)   -> Django default `id`      (API name: completion_id)
    occurrence_id (FK)   -> `occurrence`             (API name: occurrence_id)
    """

    occurrence = models.OneToOneField(
        "habits.HabitOccurrence",
        on_delete=models.CASCADE,
        related_name="completion",
    )
    progress_value = models.PositiveIntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "completion_record"

    def __str__(self):
        return f"Completion of occurrence {self.occurrence_id}"
