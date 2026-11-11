"""Папки-темы уроков внутри курса: «№26», «Повторение», «Проверочные»…

Тема урока угадывается по названию («26 задание урок 3» → «№26», на 3-е место),
учитель может поменять её и порядок уроков в «Базе уроков».
"""
import re

REVIEW = 'Повторение'
TESTS = 'Проверочные'
MAX_TOPIC_LENGTH = 60

_NUMBER = re.compile(r'^\s*(\d{1,2})\s*(?:-?е\s*)?задани', re.IGNORECASE)
_LESSON = re.compile(r'урок\s*(\d{1,3})', re.IGNORECASE)


def guess_topic(title):
    """Тема по названию урока; '' — не понятно (урок попадёт в «Без темы»)"""
    title = title or ''
    low = title.casefold()
    if 'повтор' in low:
        return REVIEW
    if 'проверочн' in low or 'контрольн' in low:
        return TESTS
    match = _NUMBER.match(title)
    return f'№{int(match.group(1))}' if match else ''


def title_order(title, lesson_id):
    """Порядок внутри темы по названию: «урок 3» — третий, без номера урока — в конце по дате создания"""
    match = _LESSON.search(title or '')
    return (int(match.group(1)) if match else 1000, lesson_id or 0)


def next_position(topic):
    """Место в конце темы"""
    from django.db.models import Max
    from .models import Assignment
    return (Assignment.objects.filter(topic=topic).aggregate(m=Max('position'))['m'] or 0) + 1


def clean_topic(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()[:MAX_TOPIC_LENGTH]
