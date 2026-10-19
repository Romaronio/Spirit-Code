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
        'NAME': BASE_DIR / 'db.sqlite3',
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
MEDIA_ROOT = BASE_DIR / 'media'  # сюда сохраняются файлы домашних заданий, раздаёт nginx


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
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 100,
}