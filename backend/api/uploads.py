"""Ограничения на загружаемые файлы: размер, тип и общий объём у ученика.

Те же лимиты продублированы на фронте (src/utils/uploads.ts) — только для
удобства, проверяет всё равно сервер. Меняете здесь — поменяйте и там.
"""
import os

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from rest_framework import serializers

MB = 1024 * 1024

ALLOWED_EXTENSIONS = {
    # документы
    'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md',
    'ppt', 'pptx', 'odp', 'xls', 'xlsx', 'ods', 'csv',
    # изображения (фото тетради и т.п.)
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp',
    # архивы
    'zip', 'rar', '7z',
    # код
    'py', 'ipynb', 'js', 'ts', 'html', 'css', 'json', 'sql',
    'c', 'cpp', 'h', 'cs', 'java', 'kt', 'go', 'php', 'rb', 'pas', 'sh',
}


def _size_mb(size):
    return f'{size / MB:.1f}'.rstrip('0').rstrip('.')


def validate_upload(f):
    """Проверяет один файл. Используется и как валидатор поля модели"""
    name = os.path.basename(f.name)
    ext = os.path.splitext(name)[1].lower().lstrip('.')
    if ext not in ALLOWED_EXTENSIONS:
        raise ValidationError(f'Файл «{name}»: такой тип файлов загружать нельзя')
    if f.size > settings.MAX_UPLOAD_FILE_SIZE:
        raise ValidationError(
            f'Файл «{name}» больше {_size_mb(settings.MAX_UPLOAD_FILE_SIZE)} МБ'
        )


def check_uploads(files):
    """То же для списка файлов из запроса, с ошибкой в формате DRF"""
    for f in files:
        try:
            validate_upload(f)
        except ValidationError as e:
            raise serializers.ValidationError({'files': e.messages})


def stored_size(field_file):
    """Размер уже сохранённого файла; пропавший с диска считаем нулём"""
    try:
        return field_file.size
    except (FileNotFoundError, OSError, ValueError):
        return 0


def check_student_quota(student, new_files, deleted_ids=()):
    """Не даёт ученику занять больше STUDENT_STORAGE_QUOTA"""
    from .models import StudentHomeworkFile

    used = sum(
        stored_size(f.file)
        for f in StudentHomeworkFile.objects.filter(student_homework__student=student)
        .exclude(id__in=deleted_ids)
    )
    total = used + sum(f.size for f in new_files)
    quota = settings.STUDENT_STORAGE_QUOTA
    if total > quota:
        raise serializers.ValidationError({'files': [
            f'Превышен лимит места: занято {_size_mb(used)} из {_size_mb(quota)} МБ. '
            'Удалите старые файлы из ответов или попросите учителя.'
        ]})


def delete_file_on_commit(field_file):
    """Удаляет файл с диска, когда удаление записи окончательно сохранено в БД"""
    if not field_file:
        return
    storage, name = field_file.storage, field_file.name
    transaction.on_commit(lambda: storage.delete(name))
