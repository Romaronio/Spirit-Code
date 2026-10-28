from django.db import migrations, models


def to_numbered(apps, schema_editor):
    """Номера → задания по номерам; общий LaTeX уходит к первому номеру"""
    Assignment = apps.get_model('api', 'Assignment')
    for a in Assignment.objects.exclude(task_numbers=[]):
        numbers = sorted(set(a.task_numbers))
        a.numbered_tasks = [{'number': n, 'latex': ''} for n in numbers]
        if a.tasks_latex:
            a.numbered_tasks[0]['latex'] = a.tasks_latex
            a.tasks_latex = ''
        a.save(update_fields=['numbered_tasks', 'tasks_latex'])


def to_numbers(apps, schema_editor):
    Assignment = apps.get_model('api', 'Assignment')
    for a in Assignment.objects.exclude(numbered_tasks=[]):
        a.task_numbers = [t['number'] for t in a.numbered_tasks]
        if not a.tasks_latex:
            a.tasks_latex = next((t['latex'] for t in a.numbered_tasks if t['latex']), '')
        a.save(update_fields=['task_numbers', 'tasks_latex'])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0017_assignment_task_numbers'),
    ]

    operations = [
        migrations.AddField(
            model_name='assignment',
            name='numbered_tasks',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(to_numbered, to_numbers),
        migrations.RemoveField(
            model_name='assignment',
            name='task_numbers',
        ),
    ]
