from django.db import migrations, models


def mark_owner(apps, schema_editor):
    """Создатель платформы — учитель roman (имя без учёта регистра); если такого нет —
    самый первый учитель"""
    Account = apps.get_model('api', 'Account')
    teachers = list(Account.objects.filter(role='teacher').order_by('id'))
    owner = next((a for a in teachers if a.name.strip().casefold() == 'roman'), None)
    if owner is None and teachers:
        owner = teachers[0]
    if owner is not None:
        owner.is_owner = True
        owner.save(update_fields=['is_owner'])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0038_curator_role'),
    ]

    operations = [
        migrations.AddField(
            model_name='account',
            name='is_owner',
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(mark_owner, migrations.RunPython.noop),
    ]
