from api.models import Account

# Создаём учителя roman
Account.objects.create(
    name='roman',
    password='R_070607_S',
    role='teacher',
    subjects=[]
)

print('Пользователь roman добавлен!')
