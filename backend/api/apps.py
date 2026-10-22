from django.apps import AppConfig


class ApiConfig(AppConfig):
    name = 'api'

    def ready(self):
        from . import signals  # noqa: F401 — подключает удаление файлов с диска
