"""Токены доступа к комнатам LiveKit.

Токен — JWT (HS256), подписанный секретом LiveKit; формат описан в документации LiveKit
(«Access tokens»). Отдельная библиотека не нужна: хватает hmac из стандартной библиотеки.
"""
import base64
import hashlib
import hmac
import json
import logging
import time
import urllib.request

from django.conf import settings

TOKEN_TTL_SECONDS = 6 * 60 * 60  # на время урока; переподключение берёт новый токен

logger = logging.getLogger(__name__)


class LiveKitNotConfigured(Exception):
    pass


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def is_configured() -> bool:
    return bool(settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET)


def _sign(payload: dict) -> str:
    header = {'alg': 'HS256', 'typ': 'JWT'}
    signing_input = f"{_b64(json.dumps(header).encode())}.{_b64(json.dumps(payload).encode())}"
    signature = hmac.new(settings.LIVEKIT_API_SECRET.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f'{signing_input}.{_b64(signature)}'


def make_token(*, identity: str, name: str, room: str, is_admin: bool) -> str:
    """Токен на вход в комнату room. Учитель (is_admin) может управлять комнатой."""
    if not is_configured():
        raise LiveKitNotConfigured('Созвоны не настроены: нет LIVEKIT_API_KEY / LIVEKIT_API_SECRET')
    now = int(time.time())
    return _sign({
        'iss': settings.LIVEKIT_API_KEY,
        'sub': identity,
        'name': name,
        'nbf': now - 10,
        'exp': now + TOKEN_TTL_SECONDS,
        'video': {
            'room': room,
            'roomJoin': True,
            'roomAdmin': is_admin,
            'canPublish': True,
            'canSubscribe': True,
            'canPublishData': True,
        },
    })


def delete_room(room: str) -> None:
    """Закрывает комнату на сервере LiveKit — все участники сразу отключаются.
    Ошибки только пишем в лог: созвон в базе всё равно завершён, а пустая
    комната LiveKit закроется сама."""
    if not (is_configured() and settings.LIVEKIT_API_HOST):
        return
    now = int(time.time())
    token = _sign({
        'iss': settings.LIVEKIT_API_KEY,
        'nbf': now - 10,
        'exp': now + 60,
        'video': {'roomCreate': True},
    })
    request = urllib.request.Request(
        settings.LIVEKIT_API_HOST.rstrip('/') + '/twirp/livekit.RoomService/DeleteRoom',
        data=json.dumps({'room': room}).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        urllib.request.urlopen(request, timeout=5).close()
    except Exception as e:  # noqa: BLE001 — сеть, 404 «комнаты нет» и т.п.
        logger.warning('LiveKit DeleteRoom %s: %s', room, e)
