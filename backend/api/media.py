"""Подписанные ссылки на загруженные файлы (/media/...).

Файлы скачиваются обычной ссылкой <a href>, поэтому токен в заголовке туда
не передать. Вместо этого API отдаёт ссылку с подписью `?s=...`: её может
получить только тот, кому сервер показал задание, и она живёт ограниченное время.
Без верной подписи файл не отдаётся (на сервере это проверяет Caddy через
forward_auth → media_auth, локально — protected_media).
"""
from urllib.parse import parse_qs, unquote, urlencode, urlsplit

from django.conf import settings
from django.core import signing
from django.http import HttpResponse, HttpResponseForbidden
from django.views.static import serve

_signer = signing.TimestampSigner(salt='media-files')


def signed_url(request, file):
    """Абсолютная ссылка на файл с подписью"""
    signature = _signer.sign(file.name)[len(file.name) + 1:]
    url = f'{file.url}?{urlencode({"s": signature})}'
    return request.build_absolute_uri(url) if request else url


def is_valid(name, signature):
    """Проверяет, что подпись выдана именно для этого файла и ещё не истекла"""
    if not name or not signature:
        return False
    try:
        _signer.unsign(f'{name}:{signature}', max_age=settings.MEDIA_URL_TTL_SECONDS)
    except signing.BadSignature:  # сюда же попадает SignatureExpired
        return False
    return True


def _name_from_path(path):
    """'/media/lesson_files/%D0%A4.pdf' → 'lesson_files/Ф.pdf'"""
    path = unquote(path)
    return path[len(settings.MEDIA_URL):] if path.startswith(settings.MEDIA_URL) else None


def media_auth(request):
    """Проверка для Caddy forward_auth: 2xx — отдать файл, 403 — нет"""
    parts = urlsplit(request.headers.get('X-Forwarded-Uri', ''))
    signature = parse_qs(parts.query).get('s', [''])[0]
    if is_valid(_name_from_path(parts.path), signature):
        return HttpResponse(status=204)
    return HttpResponseForbidden('Ссылка недействительна или устарела')


def protected_media(request, path):
    """Раздача файлов при локальной разработке (DEBUG) с той же проверкой подписи"""
    if not is_valid(path, request.GET.get('s', '')):
        return HttpResponseForbidden('Ссылка недействительна или устарела')
    return serve(request, path, document_root=settings.MEDIA_ROOT)
