# Django Backend для Spirit Code

## Что это?

Это backend часть твоего проекта Spirit Code, написанная на Django. Он предоставляет REST API для работы с:
- Аккаунтами (учителя и ученики)
- Заданиями
- Файлами уроков

## Как запустить?

### 1. Активируй виртуальное окружение

**В PowerShell:**
```powershell
cd backend
.venv\Scripts\Activate.ps1
```

**В командной строке (cmd):**
```cmd
cd backend
.venv\Scripts\activate.bat
```

### 2. Запусти сервер

```bash
python manage.py runserver
```

Сервер запустится на `http://localhost:8000`

### 3. Проверь что работает

Открой в браузере: `http://localhost:8000/api/`

Ты увидишь список доступных API endpoints.

## API Endpoints

### Аккаунты
- `GET /api/accounts/` - получить все аккаунты
- `POST /api/accounts/` - создать новый аккаунт
- `GET /api/accounts/{id}/` - получить конкретный аккаунт
- `PUT /api/accounts/{id}/` - обновить аккаунт
- `DELETE /api/accounts/{id}/` - удалить аккаунт
- `POST /api/accounts/login/` - войти в систему

**Пример создания аккаунта:**
```json
{
  "name": "Иван",
  "password": "123456",
  "role": "student",
  "subjects": ["Математика", "Физика"]
}
```

**Пример входа:**
```json
{
  "name": "Иван",
  "password": "123456"
}
```

### Задания
- `GET /api/assignments/` - получить все задания
- `GET /api/assignments/?subject=Математика` - отфильтровать по предмету
- `POST /api/assignments/` - создать новое задание
- `GET /api/assignments/{id}/` - получить конкретное задание
- `PUT /api/assignments/{id}/` - обновить задание
- `DELETE /api/assignments/{id}/` - удалить задание

**Пример создания задания:**
```json
{
  "title": "Домашнее задание по алгебре",
  "subject": "Математика",
  "deadline": "2026-10-20",
  "recording_url": "https://youtube.com/...",
  "description": "Решить задачи 1-10"
}
```

### Файлы уроков
- `GET /api/lesson-files/` - получить все файлы
- `POST /api/lesson-files/` - создать новый файл
- `GET /api/lesson-files/{id}/` - получить конкретный файл
- `PUT /api/lesson-files/{id}/` - обновить файл
- `DELETE /api/lesson-files/{id}/` - удалить файл

**Пример создания файла:**
```json
{
  "assignment": 1,
  "name": "Презентация.pdf",
  "url": "https://drive.google.com/..."
}
```

## Структура проекта

```
backend/
├── .venv/              # виртуальное окружение Python
├── api/                # приложение с API
│   ├── migrations/     # миграции базы данных
│   ├── models.py       # модели данных (Account, Assignment, LessonFile)
│   ├── serializers.py  # сериализаторы для JSON
│   ├── views.py        # обработчики запросов
│   └── urls.py         # маршруты API
├── config/             # настройки Django проекта
│   ├── settings.py     # главный файл настроек
│   └── urls.py         # главные маршруты
├── db.sqlite3          # база данных SQLite
├── manage.py           # утилита для управления Django
└── requirements.txt    # список зависимостей
```

## Полезные команды

### Создать суперпользователя (для админки)
```bash
python manage.py createsuperuser
```

После этого можешь зайти в админку: `http://localhost:8000/admin/`

### Создать миграции (после изменения моделей)
```bash
python manage.py makemigrations
python manage.py migrate
```

### Проверить код на ошибки
```bash
python manage.py check
```

### Открыть интерактивную консоль Django
```bash
python manage.py shell
```

## Что дальше?

Теперь нужно подключить твой React frontend к этому API:

1. В React измени все места где используется `localStorage` на запросы к API
2. Используй `fetch` или `axios` для HTTP запросов
3. URL API: `http://localhost:8000/api/`

**Пример запроса из React:**
```javascript
// Получить все задания
const response = await fetch('http://localhost:8000/api/assignments/')
const assignments = await response.json()

// Создать новое задание
const response = await fetch('http://localhost:8000/api/assignments/', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'Новое задание',
    subject: 'Математика',
    deadline: '2026-10-20',
  })
})
```

## Важные замечания

- **CORS настроен** для работы с React на `http://localhost:5173` (порт Vite по умолчанию)
- **Пароли хранятся в открытом виде** - это нормально для учебного проекта, но для реального проекта нужно использовать хеширование
- **База данных SQLite** - подходит для разработки, но для продакшена лучше использовать PostgreSQL
- **DEBUG = True** - это режим разработки, для продакшена нужно выключить

## Если что-то не работает

1. Проверь, что виртуальное окружение активировано (должно быть `(.venv)` в начале строки)
2. Проверь, что все пакеты установлены: `pip list`
3. Проверь, что сервер запущен: `python manage.py runserver`
4. Посмотри ошибки в консоли где запущен Django

## Контакты

Если что-то непонятно - спрашивай! Я помогу разобраться.
