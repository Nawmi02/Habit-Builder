import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('tracking', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Badge',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.SlugField(unique=True)),
                ('name', models.CharField(max_length=60)),
                ('description', models.CharField(max_length=200)),
                ('condition_type', models.CharField(choices=[('TOTAL_CHECKINS', 'Total completed habits'), ('STREAK_DAYS', 'Streak length in days'), ('TOTAL_POINTS', 'Total points')], max_length=20)),
                ('condition_value', models.PositiveIntegerField(validators=[django.core.validators.MinValueValidator(1)])),
            ],
            options={
                'db_table': 'badge',
                'ordering': ['condition_type', 'condition_value'],
            },
        ),
        migrations.CreateModel(
            name='PointTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('related_type', models.CharField(choices=[('COMPLETION', 'Habit completed'), ('DAILY_BONUS', 'All habits done today'), ('STREAK', 'Streak milestone'), ('BADGE', 'Badge unlocked')], max_length=11)),
                ('points', models.IntegerField()),
                ('reason', models.CharField(max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('completion', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='point_transaction', to='tracking.completionrecord')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='point_transactions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'point_transaction',
                'ordering': ['-created_at', '-id'],
                'indexes': [models.Index(fields=['user', 'created_at'], name='pt_user_created_idx')],
                'constraints': [
                    models.UniqueConstraint(condition=~models.Q(related_type='COMPLETION'), fields=('user', 'reason'), name='uniq_bonus_reason_per_user'),
                    models.CheckConstraint(condition=~models.Q(related_type='COMPLETION') | models.Q(completion__isnull=False), name='completion_points_need_completion'),
                ],
            },
        ),
        migrations.CreateModel(
            name='UserBadge',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('unlocked_at', models.DateTimeField(auto_now_add=True)),
                ('badge', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='user_badges', to='gamification.badge')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='user_badges', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'user_badge',
                'ordering': ['-unlocked_at'],
                'constraints': [models.UniqueConstraint(fields=('user', 'badge'), name='uniq_user_badge')],
            },
        ),
    ]
