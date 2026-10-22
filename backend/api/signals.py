from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import HomeworkFile, LessonFile, StudentHomeworkFile
from .uploads import delete_file_on_commit


# Срабатывает и при каскадном удалении (задание → его файлы, ученик → его ответы),
# поэтому файлы не остаются на диске «сиротами»
@receiver(post_delete, sender=LessonFile)
@receiver(post_delete, sender=HomeworkFile)
@receiver(post_delete, sender=StudentHomeworkFile)
def delete_file_from_disk(sender, instance, **kwargs):
    delete_file_on_commit(instance.file)
