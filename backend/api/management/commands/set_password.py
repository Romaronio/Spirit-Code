from getpass import getpass

from django.core.management.base import BaseCommand, CommandError

from api.models import Account
from api.serializers import MIN_PASSWORD_LENGTH


class Command(BaseCommand):
    """Меняет пароль аккаунта (или создаёт учителя с флагом --teacher).

    На сервере: docker compose exec backend python manage.py set_password roman
    """
    help = 'Задать пароль аккаунту; с --teacher создаёт учителя, если его нет'

    def add_arguments(self, parser):
        parser.add_argument('name', help='Имя аккаунта')
        parser.add_argument(
            '--teacher',
            action='store_true',
            help='Создать аккаунт учителя, если такого имени ещё нет',
        )

    def handle(self, *args, name, teacher, **options):
        account = Account.objects.filter(name=name).first()
        if account is None and not teacher:
            raise CommandError(f'Аккаунт «{name}» не найден (добавьте --teacher, чтобы создать учителя)')

        password = getpass('Новый пароль: ')
        if len(password) < MIN_PASSWORD_LENGTH:
            raise CommandError(f'Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов')
        if password != getpass('Повторите пароль: '):
            raise CommandError('Пароли не совпадают')

        if account is None:
            account = Account(name=name, role='teacher', subjects=[])
        account.set_password(password)
        account.save()
        # Старые сессии больше не действуют
        account.tokens.all().delete()

        self.stdout.write(self.style.SUCCESS(f'Пароль для «{name}» сохранён'))
