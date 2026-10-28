from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0015_tasks_latex'),
    ]

    operations = [
        migrations.AddField(
            model_name='assignment',
            name='task_number',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]
