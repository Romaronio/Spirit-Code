from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from .models import AuthToken, hash_token


class TokenAuthentication(BaseAuthentication):
    """Проверяет заголовок `Authorization: Token <ключ>`"""
    keyword = b'token'

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts or parts[0].lower() != self.keyword:
            return None  # заголовка нет — пусть решают права доступа
        if len(parts) != 2:
            raise AuthenticationFailed('Неверный заголовок авторизации')

        try:
            key = parts[1].decode()
        except UnicodeError:
            raise AuthenticationFailed('Неверный заголовок авторизации')

        token = (
            AuthToken.objects.select_related('account')
            .filter(key_hash=hash_token(key))
            .first()
        )
        if token is None:
            raise AuthenticationFailed('Сессия недействительна, войдите снова')
        if token.is_expired:
            token.delete()
            raise AuthenticationFailed('Сессия истекла, войдите снова')

        return (token.account, token)

    def authenticate_header(self, request):
        # Благодаря этому DRF отвечает 401 (а не 403), когда токена нет
        return 'Token'
