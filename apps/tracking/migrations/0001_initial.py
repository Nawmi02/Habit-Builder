from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('habits', '0002_completion_skip_streak_reminder_reward'),
    ]

    operations = [
        migrations.CreateModel(
            name='CompletionRecord',
            fields=[],
            options={
                'proxy': True,
                'indexes': [],
                'constraints': [],
            },
            bases=('habits.completionrecord',),
        ),
    ]
