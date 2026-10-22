import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    """Делает архив: целостный снимок базы + все загруженные файлы (media).

    Снимок базы берётся через встроенный механизм резервного копирования SQLite,
    поэтому он не «бьётся», даже если в этот момент кто-то сохраняет ответ.

    На сервере: docker compose exec -T backend python manage.py backup
    Печатает имя созданного архива — по нему его скачивает scripts/backup-from-server.ps1.
    """
    help = 'Создать архив с базой и файлами (media) и удалить старые архивы'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dir',
            help='Куда сохранить архив (по умолчанию — папка backups рядом с базой)',
        )
        parser.add_argument(
            '--keep',
            type=int,
            default=5,
            help='Сколько последних архивов хранить (по умолчанию 5)',
        )

    def handle(self, *args, dir=None, keep, **options):
        db_path = Path(settings.DATABASES['default']['NAME'])
        if not db_path.exists():
            raise CommandError(f'База не найдена: {db_path}')

        out_dir = Path(dir) if dir else db_path.parent / 'backups'
        out_dir.mkdir(parents=True, exist_ok=True)
        name = f"spirit-code-{datetime.now():%Y-%m-%d_%H-%M}.zip"
        archive = out_dir / name
        media_root = Path(settings.MEDIA_ROOT)

        with tempfile.TemporaryDirectory() as tmp:
            snapshot = Path(tmp) / 'db.sqlite3'
            source = sqlite3.connect(db_path)
            target = sqlite3.connect(snapshot)
            try:
                source.backup(target)
            finally:
                target.close()
                source.close()

            # Пишем во временный файл и переименовываем в конце, чтобы
            # недописанный архив никогда не выглядел как готовый
            partial = archive.with_suffix('.zip.part')
            with zipfile.ZipFile(partial, 'w', zipfile.ZIP_DEFLATED) as zf:
                zf.write(snapshot, 'db.sqlite3')
                if media_root.exists():
                    for path in sorted(media_root.rglob('*')):
                        if path.is_file():
                            zf.write(path, Path('media') / path.relative_to(media_root))
            partial.replace(archive)

        # Оставляем только последние `keep` архивов
        archives = sorted(out_dir.glob('spirit-code-*.zip'))
        for old in archives[:-keep] if keep > 0 else []:
            old.unlink()

        self.stdout.write(name)
