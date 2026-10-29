"""
Django settings for config project.

Работает и локально, и на сервере. Секреты и адреса берутся из переменных
окружения (на сервере их задаёт файл .env, локально можно ничего не задавать).
"""

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env_list(name, default=""):
    """Читает список через запятую из переменной окружения."""
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


# --- Основные настройки -----------------------------------------------------

# Локально DEBUG включён по умолчанию, на сервере в .env ставим DJANGO_DEBUG=0
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-insecure-key"  # только для локальной разработки
    else:
        raise ImproperlyConfigured("Задайте DJANGO_SECRET_KEY в окружении (.env на сервере)")

# На сервере: DJANGO_ALLOWED_HOSTS=138.16.172.241,ваш-домен.ru
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

# Нужно для входа в админку и POST-запросов, когда сайт открыт по адресу сервера.
# На сервере: DJANGO_CSRF_TRUSTED_ORIGINS=http://138.16.172.241
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")


# --- Приложения -------------------------------------------------------------

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'api',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# --- База данных ------------------------------------------------------------

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': os.environ.get('DJANGO_DB_PATH', BASE_DIR / 'db.sqlite3'),
    }
}


# --- Пароли -----------------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


# --- Язык и время -----------------------------------------------------------

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True


# --- Статика и загруженные файлы -------------------------------------------

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'  # сюда collectstatic собирает файлы, раздаёт nginx

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'  # сюда сохраняются файлы домашних заданий, раздаёт Caddy

# Лимиты на загрузку файлов (см. api/uploads.py и src/utils/uploads.ts).
# Общий лимит размера запроса (50 МБ) задан в Caddyfile.
MAX_UPLOAD_FILE_SIZE = int(os.environ.get('DJANGO_MAX_UPLOAD_MB', '10')) * 1024 * 1024
STUDENT_STORAGE_QUOTA = int(os.environ.get('DJANGO_STUDENT_QUOTA_MB', '500')) * 1024 * 1024

# Сколько живёт ссылка на файл (см. api/media.py). Ссылки обновляются
# каждый раз, когда открывается страница задания.
MEDIA_URL_TTL_SECONDS = int(os.environ.get('DJANGO_MEDIA_URL_TTL', str(6 * 60 * 60)))


# --- Почта ------------------------------------------------------------------

MAILERS = {
    'default': {
        'BACKEND': 'django.core.mail.backends.console.EmailBackend',
    },
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# --- CORS -------------------------------------------------------------------
# Локально фронт (Vite) и Django работают на разных портах, поэтому нужен CORS.
# На сервере фронт и API на одном адресе, и CORS не требуется;
# если понадобится, добавьте адрес в DJANGO_CORS_ALLOWED_ORIGINS в .env.

CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",  # Vite dev server
    "http://localhost:3000",  # альтернативный порт
] + env_list("DJANGO_CORS_ALLOWED_ORIGINS")

CORS_ALLOW_CREDENTIALS = True


# --- HTTPS (включайте только после настройки сертификата) ------------------
# В .env на сервере: DJANGO_HTTPS=1

if os.environ.get("DJANGO_HTTPS", "0") == "1":
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True


# --- REST Framework ---------------------------------------------------------

REST_FRAMEWORK = {
    # Вход по токену в заголовке Authorization (см. api/authentication.py).
    # Сессии/cookie не используются, поэтому CSRF для API не нужен.
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'api.authentication.TokenAuthentication',
    ],
    # По умолчанию всё закрыто: доступ открывается явно в каждом view
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.ScopedRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'login': os.environ.get('DJANGO_LOGIN_RATE', '10/min'),  # защита от перебора паролей
        'photo_latex': os.environ.get('DJANGO_PHOTO_LATEX_RATE', '60/hour'),  # бережём лимит GigaChat
    },
    # Сколько прокси стоит перед Django (Caddy = 1). Нужно, чтобы лимит входа
    # считался по настоящему IP пользователя, а не по IP прокси.
    'NUM_PROXIES': int(os.environ['DJANGO_NUM_PROXIES']) if os.environ.get('DJANGO_NUM_PROXIES') else None,
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 100,
}

# Сколько дней живёт токен входа
AUTH_TOKEN_TTL_DAYS = int(os.environ.get('DJANGO_TOKEN_TTL_DAYS', '30'))


# --- Фото задания → LaTeX (api/photo_latex.py) -------------------------------

# Ключ авторизации из кабинета developers.sber.ru (GigaChat API). Пусто — функция выключена
GIGACHAT_AUTH_KEY = os.environ.get('GIGACHAT_AUTH_KEY', '').strip()
GIGACHAT_SCOPE = os.environ.get('GIGACHAT_SCOPE', 'GIGACHAT_API_PERS')
GIGACHAT_MODEL = os.environ.get('GIGACHAT_MODEL', 'GigaChat-2-Max')
# Корневой и промежуточный сертификаты Минцифры (с gu-st.ru) — ими подписан сертификат GigaChat
GIGACHAT_CA_BUNDLE = BASE_DIR / 'certs' / 'russian_trusted_ca.pem'
TESSERACT_CMD = os.environ.get('TESSERACT_CMD', 'tesseract')

# Созвоны (LiveKit). Ключ и секрет — те же, что в конфиге livekit-server.
# LIVEKIT_URL — адрес для браузера (wss://…); пусто — тот же сайт по пути /livekit
# (на сервере его проксирует Caddy, локально — Vite). По умолчанию — ключи dev-режима
# `livekit-server --dev`, только при DEBUG.
LIVEKIT_URL = os.environ.get('LIVEKIT_URL', '').strip()
LIVEKIT_API_KEY = os.environ.get('LIVEKIT_API_KEY', 'devkey' if DEBUG else '').strip()
LIVEKIT_API_SECRET = os.environ.get('LIVEKIT_API_SECRET', 'secret' if DEBUG else '').strip()
# Адрес livekit-server для запросов с бэкенда (закрыть комнату, когда учитель завершил урок)
LIVEKIT_API_HOST = os.environ.get('LIVEKIT_API_HOST', 'http://localhost:7880' if DEBUG else '').strip()
