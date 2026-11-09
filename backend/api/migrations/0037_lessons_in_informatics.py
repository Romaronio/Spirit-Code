from django.db import migrations, models

INFORMATICS = 'Информатика'
NOT_INFORMATICS = {'математика', 'русский язык', 'информатика'}


def add_informatics(apps, schema_editor):
    """Уроки всех курсов, кроме Математики и Русского языка, попадают и в папку «Информатика»
    (новые уроки туда добавляет сериализатор)"""
    Assignment = apps.get_model('api', 'Assignment')
    changed = False
    for a in Assignment.objects.all():
        subjects = [a.subject, *(a.extra_subjects or [])]
        keys = {' '.join(str(s).split()).casefold() for s in subjects if s and str(s).strip()}
        if INFORMATICS.casefold() in keys or not keys - NOT_INFORMATICS:
            continue
        a.extra_subjects = [*(a.extra_subjects or []), INFORMATICS]
        a.save(update_fields=['extra_subjects'])
        changed = True
    if changed:
        Subject = apps.get_model('api', 'Subject')
        if not any(s.name.casefold() == INFORMATICS.casefold() for s in Subject.objects.all()):
            Subject.objects.create(name=INFORMATICS)
        # Сигналы в миграции не срабатывают — сами сообщаем открытым страницам о новых данных
        DataVersion = apps.get_model('api', 'DataVersion')
        if not DataVersion.objects.filter(pk=1).update(value=models.F('value') + 1):
            DataVersion.objects.get_or_create(pk=1, defaults={'value': 1})


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0036_classwork_not_required'),
    ]

    operations = [
        migrations.RunPython(add_informatics, migrations.RunPython.noop),
    ]
