from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import (
    Account,
    AnswerComment,
    Assignment,
    CallAnswerFile,
    DataVersion,
    Homework,
    HomeworkFile,
    LessonFile,
    Payment,
    StudentHomework,
    StudentHomeworkFile,
    Subject,
)
from .uploads import delete_file_on_commit


# Срабатывает и при каскадном удалении (задание → его файлы, ученик → его ответы),
# поэтому файлы не остаются на диске «сиротами»
@receiver(post_delete, sender=LessonFile)
@receiver(post_delete, sender=HomeworkFile)
@receiver(post_delete, sender=StudentHomeworkFile)
@receiver(post_delete, sender=CallAnswerFile)
def delete_file_from_disk(sender, instance, **kwargs):
    delete_file_on_commit(instance.file)


# Что показывают страницы без перезагрузки: изменилось — растёт номер версии данных (GET /api/updates/)
WATCHED = (Account, Assignment, Homework, LessonFile, HomeworkFile, StudentHomework, StudentHomeworkFile,
           AnswerComment, Payment, Subject)


def bump_data_version(sender, **kwargs):
    if kwargs.get('raw'):  # загрузка фикстур
        return
    DataVersion.bump()


for _model in WATCHED:
    post_save.connect(bump_data_version, sender=_model, dispatch_uid=f'data-version-save-{_model.__name__}')
    post_delete.connect(bump_data_version, sender=_model, dispatch_uid=f'data-version-delete-{_model.__name__}')
