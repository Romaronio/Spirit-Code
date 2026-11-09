from django.db import migrations, models


def require_detailed(apps, schema_editor):
    """Старые номера переводим на «Развёрнутый ответ обязателен», как и новые.
    Номера «Только краткий ответ» не трогаем."""
    changed = False
    for name in ('Assignment', 'Homework'):
        Model = apps.get_model('api', name)
        for obj in Model.objects.exclude(numbered_tasks=[]):
            tasks = obj.numbered_tasks or []
            touched = False
            for t in tasks:
                if not t.get('short_only') and t.get('detailed_required') is not True:
                    t['detailed_required'] = True
                    touched = True
            if touched:
                obj.numbered_tasks = tasks
                obj.save(update_fields=['numbered_tasks'])
                changed = True
    if changed:
        # Сигналы в миграции не срабатывают — сами сообщаем открытым страницам о новых данных
        DataVersion = apps.get_model('api', 'DataVersion')
        if not DataVersion.objects.filter(pk=1).update(value=models.F('value') + 1):
            DataVersion.objects.get_or_create(pk=1, defaults={'value': 1})


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0033_tikz_figures'),
    ]

    operations = [
        # Откат ничего не меняет: не отличить флаг, поставленный миграцией, от выбранного учителем
        migrations.RunPython(require_detailed, migrations.RunPython.noop),
    ]
