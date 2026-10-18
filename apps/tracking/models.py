"""
ER entity 5: COMPLETION_RECORD.

The habits app owns the concrete table and full field set. This proxy gives
gamification the stable tracking.CompletionRecord model label it references,
without registering a second model against the same database table.
"""

from apps.habits.models import CompletionRecord as HabitCompletionRecord


class CompletionRecord(HabitCompletionRecord):
    """
    ER entity 5: COMPLETION_RECORD

    completion_id (PK)   -> Django default `id`      (API name: completion_id)
    occurrence_id (FK)   -> `occurrence`             (API name: occurrence_id)
    """

    class Meta:
        proxy = True

    def __str__(self):
        return f"Completion of occurrence {self.occurrence_id}"
