from django.db import migrations

EXAMS = 'Пробники'  # как api.topics.EXAMS на момент миграции


def exams_to_folder(apps, schema_editor):
    """Пробники без папки (с таймером или «пробник» в названии) — в папку «Пробники», по номеру в названии"""
    Assignment = apps.get_model('api', 'Assignment')
    lessons = [
        a for a in Assignment.objects.filter(topic='')
        if a.exam_minutes or 'пробник' in (a.title or '').casefold()
    ]
    start = max(Assignment.objects.filter(topic=EXAMS).values_list('position', flat=True), default=0)
    lessons.sort(key=lambda a: (_number(a.title), a.id))
    for i, a in enumerate(lessons, start=start + 1):
        a.topic = EXAMS
        a.position = i
        a.save(update_fields=['topic', 'position'])


def _number(title):
    import re
    match = re.search(r'\d+', title or '')
    return int(match.group()) if match else 1000


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0051_task_marks'),
    ]

    operations = [
        migrations.RunPython(exams_to_folder, migrations.RunPython.noop),
    ]
