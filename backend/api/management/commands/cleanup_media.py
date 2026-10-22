from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from api.models import HomeworkFile, LessonFile, StudentHomeworkFile


class Command(BaseCommand):
    """Удаляет из MEDIA_ROOT файлы, на которые нет ссылок в базе.

    Такие файлы остались от удалений до того, как появилось автоудаление.
    Сначала посмотрите список: python manage.py cleanup_media
    Потом удалите:               python manage.py cleanup_media --delete
    """
    help = 'Найти (и с --delete удалить) файлы в media, которых нет в базе'

    def add_arguments(self, parser):
        parser.add_argument('--delete', action='store_true', help='Действительно удалить файлы')

    def handle(self, *args, delete, **options):
        root = Path(settings.MEDIA_ROOT)
        used = set()
        for model in (LessonFile, HomeworkFile, StudentHomeworkFile):
            used.update(n for n in model.objects.values_list('file', flat=True) if n)

        orphans = [
            p for p in root.rglob('*')
            if p.is_file() and p.relative_to(root).as_posix() not in used
        ]
        total = sum(p.stat().st_size for p in orphans)

        for p in orphans:
            self.stdout.write(f'  {p.relative_to(root).as_posix()}')
            if delete:
                p.unlink()

        size = f'{total / 1024 / 1024:.1f} МБ'
        if delete:
            self.stdout.write(self.style.SUCCESS(f'Удалено файлов: {len(orphans)} ({size})'))
        else:
            self.stdout.write(f'Лишних файлов: {len(orphans)} ({size}). Удалить: добавьте --delete')
