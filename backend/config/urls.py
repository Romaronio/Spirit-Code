"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings

from api.media import media_auth, protected_media

urlpatterns = [
    path('admin/', admin.site.urls),
    # Caddy спрашивает здесь, можно ли отдать файл из /media/ (forward_auth)
    path('api/media-auth/', media_auth),
    path('api/', include('api.urls')),
]

# Локально файлы раздаёт Django — тоже только по подписанной ссылке.
# На сервере /media/ отдаёт Caddy и сюда такие запросы не доходят.
media_prefix = settings.MEDIA_URL.lstrip('/')
urlpatterns += [re_path(rf'^{media_prefix}(?P<path>.*)$', protected_media)]
