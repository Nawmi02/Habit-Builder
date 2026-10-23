from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("habits", "0005_habitoccurrence_completed_count_slots_and_more")]

    operations = [
        migrations.AddField(
            model_name="habit",
            name="duration_minutes",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="habitoccurrence",
            name="count_sessions",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
