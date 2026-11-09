from django.db import migrations, models


def drop_classwork_required(apps, schema_editor):
    """Развёрнутый ответ обязателен только у номеров ДЗ — у классной работы флаг убираем
    (его поставила и миграция 0034)"""
    Assignment = apps.get_model('api', 'Assignment')
    changed = False
    for a in Assignment.objects.exclude(numbered_tasks=[]):
        tasks = a.numbered_tasks or []
        if any('detailed_required' in t for t in tasks):
            for t in tasks:
                t.pop('detailed_required', None)
            a.numbered_tasks = tasks
            a.save(update_fields=['numbered_tasks'])
            changed = True
    if changed:
        # Сигналы в миграции не срабатывают — сами сообщаем открытым страницам о новых данных
        DataVersion = apps.get_model('api', 'DataVersion')
        if not DataVersion.objects.filter(pk=1).update(value=models.F('value') + 1):
            DataVersion.objects.get_or_create(pk=1, defaults={'value': 1})


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0035_student_homework_submitted_answers'),
    ]

    operations = [
        migrations.RunPython(drop_classwork_required, migrations.RunPython.noop),
    ]
