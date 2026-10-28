from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0018_assignment_numbered_tasks'),
    ]

    operations = [
        migrations.AddField(
            model_name='homework',
            name='numbered_tasks',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
