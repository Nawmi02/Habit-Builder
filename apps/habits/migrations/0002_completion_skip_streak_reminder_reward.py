from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def seed_skip_reasons(apps, schema_editor):
    SkipReason = apps.get_model("habits", "SkipReason")
    reasons = [
        ("Busy", "I did not have enough time."),
        ("Not feeling well", "I was unwell or needed to rest."),
        ("Forgot", "I forgot to do this habit."),
        ("Other", "Another reason."),
    ]
    SkipReason.objects.using(schema_editor.connection.alias).bulk_create(
        [SkipReason(name=name, description=description) for name, description in reasons],
        ignore_conflicts=True,
    )


def remove_seed_skip_reasons(apps, schema_editor):
    SkipReason = apps.get_model("habits", "SkipReason")
    SkipReason.objects.using(schema_editor.connection.alias).filter(
        name__in=["Busy", "Not feeling well", "Forgot", "Other"]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("habits", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SkipReason",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=80, unique=True)),
                ("description", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={"db_table": "skip_reason", "ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="CompletionRecord",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("progress_value", models.PositiveIntegerField(default=1)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("source", models.CharField(choices=[("APP", "App"), ("REMINDER", "Reminder"), ("SYNC", "Offline sync")], default="APP", max_length=10)),
                ("note", models.TextField(blank=True)),
                ("mood", models.CharField(blank=True, max_length=32)),
                ("synced_at", models.DateTimeField(blank=True, null=True)),
                ("occurrence", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="completion_record", to="habits.habitoccurrence")),
                ("skip_reason", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="completion_records", to="habits.skipreason")),
            ],
            options={"db_table": "completion_record"},
        ),
        migrations.AddIndex(
            model_name="completionrecord",
            index=models.Index(fields=["completed_at"], name="completion_completed_idx"),
        ),
        migrations.CreateModel(
            name="Streak",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("current_streak", models.PositiveIntegerField(default=0)),
                ("best_streak", models.PositiveIntegerField(default=0)),
                ("last_completed_date", models.DateField(blank=True, null=True)),
                ("last_skipped_date", models.DateField(blank=True, null=True)),
                ("strength_score", models.PositiveSmallIntegerField(default=0)),
                ("freeze_count", models.PositiveSmallIntegerField(default=0)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("habit", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="streak", to="habits.habit")),
            ],
            options={"db_table": "streak"},
        ),
        migrations.AddConstraint(
            model_name="streak",
            constraint=models.CheckConstraint(condition=models.Q(("strength_score__lte", 100)), name="streak_strength_lte_100"),
        ),
        migrations.CreateModel(
            name="Reminder",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("reminder_type", models.CharField(choices=[("LOCAL", "Local"), ("PUSH", "Push")], default="PUSH", max_length=5)),
                ("escalation_level", models.PositiveSmallIntegerField(default=1)),
                ("scheduled_at", models.DateTimeField()),
                ("status", models.CharField(choices=[("PENDING", "Pending"), ("SENT", "Sent"), ("CANCELLED", "Cancelled"), ("FAILED", "Failed")], default="PENDING", max_length=9)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
                ("delivery_status", models.CharField(blank=True, max_length=30)),
                ("occurrence", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="reminders", to="habits.habitoccurrence")),
            ],
            options={"db_table": "reminder", "ordering": ["scheduled_at"]},
        ),
        migrations.AddIndex(
            model_name="reminder",
            index=models.Index(fields=["status", "scheduled_at"], name="reminder_status_sched_idx"),
        ),
        migrations.AddConstraint(
            model_name="reminder",
            constraint=models.UniqueConstraint(fields=("occurrence", "reminder_type", "scheduled_at"), name="uniq_reminder_occurrence_time"),
        ),
        migrations.CreateModel(
            name="UserReward",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("total_points", models.PositiveIntegerField(default=0)),
                ("level", models.PositiveIntegerField(default=1)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="reward", to=settings.AUTH_USER_MODEL)),
            ],
            options={"db_table": "user_reward"},
        ),
        migrations.RunPython(seed_skip_reasons, remove_seed_skip_reasons),
    ]
