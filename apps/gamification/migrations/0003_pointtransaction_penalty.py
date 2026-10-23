from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("gamification", "0002_seed_badges")]

    operations = [
        migrations.AlterField(
            model_name="pointtransaction",
            name="related_type",
            field=models.CharField(
                choices=[
                    ("COMPLETION", "Habit completed"),
                    ("DAILY_BONUS", "All habits done today"),
                    ("STREAK", "Streak milestone"),
                    ("BADGE", "Badge unlocked"),
                    ("PENALTY", "Habit reminder penalty"),
                ],
                max_length=11,
            ),
        ),
    ]
