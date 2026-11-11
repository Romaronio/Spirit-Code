"""Push-уведомления в браузер (Web Push): приходят, даже когда сайт закрыт.

Ключи сайта (VAPID) создаются сами при первом обращении и хранятся в базе (PushKeys).
Подписка — адрес push-сервиса браузера (Google, Apple, Mozilla) и ключи шифрования;
у одного человека их может быть несколько: телефон, компьютер. Отправка идёт в фоновом
потоке, чтобы учитель не ждал ответа push-сервисов, когда начинает урок.
"""
import base64
import json
import logging
import threading

from cryptography.hazmat.primitives import serialization
from django.conf import settings
from django.db import close_old_connections

logger = logging.getLogger(__name__)

# Push-сервис должен знать, кому писать о проблемах с рассылкой: адрес сайта
VAPID_SUBJECT = getattr(settings, 'PUSH_VAPID_SUBJECT', 'https://spiritcode.duckdns.org')
# Уведомление о начале урока через 15 минут уже не нужно — push-сервис его выбросит
CALL_TTL_SECONDS = 15 * 60
SEND_TIMEOUT_SECONDS = 10


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def get_keys():
    """(Vapid, публичный ключ для браузера в base64url). Нет ключей — создаём"""
    from py_vapid import Vapid
    from .models import PushKeys

    keys = PushKeys.objects.first()
    if keys is None:
        vapid = Vapid()
        vapid.generate_keys()
        keys = PushKeys.objects.create(private_pem=vapid.private_pem().decode())
    vapid = Vapid.from_pem(keys.private_pem.encode())
    public = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint,
    )
    return vapid, _b64url(public)


def public_key():
    return get_keys()[1]


def _send(subscription_ids, payload, ttl):
    from pywebpush import WebPushException, webpush
    from .models import PushSubscription

    close_old_connections()
    try:
        vapid, _ = get_keys()
        for sub in PushSubscription.objects.filter(id__in=subscription_ids):
            try:
                webpush(
                    subscription_info={'endpoint': sub.endpoint, 'keys': {'p256dh': sub.p256dh, 'auth': sub.auth}},
                    data=json.dumps(payload, ensure_ascii=False),
                    vapid_private_key=vapid,
                    vapid_claims={'sub': VAPID_SUBJECT},
                    ttl=ttl,
                    timeout=SEND_TIMEOUT_SECONDS,
                )
            except WebPushException as e:
                status = getattr(e.response, 'status_code', None)
                if status in (404, 410):
                    sub.delete()  # браузер отписался или подписка устарела
                else:
                    logger.warning('Push не отправлен (%s): %s', status, e)
            except Exception:  # noqa: BLE001 — нет сети и т. п.: остальным всё равно отправляем
                logger.exception('Push не отправлен')
    finally:
        close_old_connections()


def send_to(accounts, title, body, url, ttl=CALL_TTL_SECONDS, tag=None):
    """Отправить уведомление всем устройствам этих аккаунтов (в фоне)"""
    from .models import PushSubscription

    ids = list(PushSubscription.objects.filter(account__in=accounts).values_list('id', flat=True))
    if not ids:
        return None
    payload = {'title': title, 'body': body, 'url': url, 'tag': tag or url}
    if getattr(settings, 'PUSH_SYNC', False):  # в тестах — сразу, без потока
        _send(ids, payload, ttl)
        return None
    thread = threading.Thread(target=_send, args=(ids, payload, ttl), daemon=True)
    thread.start()
    return thread
