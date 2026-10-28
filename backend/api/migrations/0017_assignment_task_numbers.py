from django.db import migrations, models


def copy_numbers(apps, schema_editor):
    Assignment = apps.get_model('api', 'Assignment')
    for a in Assignment.objects.exclude(task_number=None):
        a.task_numbers = [a.task_number]
        a.save(update_fields=['task_numbers'])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0016_assignment_task_number'),
    ]

    operations = [
        migrations.AddField(
            model_name='assignment',
            name='task_numbers',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(copy_numbers, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='assignment',
            name='task_number',
        ),
    ]
