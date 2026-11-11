"""Серия дней: сколько дней подряд ученик что-то делал на сайте.

Активность — ответ к заданию, «Отправить ответ», сообщение учителю, попытка в тренажёре печати,
ответ в созвоне (mark_active в этих местах). День считается по московскому времени.
Серия жива, пока ученик занимался сегодня или вчера: сегодня ещё можно успеть.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

MOSCOW = ZoneInfo('Europe/Moscow')
WEEK = 7


def local_day(moment=None):
    return (moment or timezone.now()).astimezone(MOSCOW).date()


def mark_active(user):
    """Отмечает сегодняшний день у ученика (у учителя и куратора серии нет)"""
    if getattr(user, 'role', None) != 'student':
        return
    from .models import ActivityDay
    ActivityDay.objects.get_or_create(student=user, day=local_day())


def streak_info(student):
    from .models import ActivityDay
    days = set(ActivityDay.objects.filter(student=student).values_list('day', flat=True))
    today = local_day()

    start = today if today in days else today - timedelta(days=1)
    current = 0
    while start - timedelta(days=current) in days:
        current += 1

    best = run = 0
    previous = None
    for day in sorted(days):
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = day

    week = [today - timedelta(days=i) for i in range(WEEK - 1, -1, -1)]
    return {
        'current': current,
        'best': best,
        'active_today': today in days,
        # Последние 7 дней, сегодня — последний: {date, active}
        'week': [{'date': d.isoformat(), 'active': d in days} for d in week],
    }


def backfill_days(apps):
    """Дни активности из того, что ученики уже присылали (для миграции)"""
    Account = apps.get_model('api', 'Account')
    ActivityDay = apps.get_model('api', 'ActivityDay')
    students = set(Account.objects.filter(role='student').values_list('id', flat=True))
    found = set()

    def add(student_id, moment):
        if student_id in students and isinstance(moment, datetime):
            found.add((student_id, local_day(moment)))

    for model, student_field, time_field in [
        ('StudentHomework', 'student_id', 'submitted_at'),
        ('StudentHomeworkFile', 'student_homework__student_id', 'created_at'),
        ('AnswerComment', 'author_id', 'created_at'),
        ('TypingResult', 'student_id', 'created_at'),
        ('CallAnswer', 'student_id', 'updated_at'),
        ('CallAnswerFile', 'answer__student_id', 'created_at'),
    ]:
        for student_id, moment in apps.get_model('api', model).objects.values_list(student_field, time_field):
            add(student_id, moment)
    ActivityDay.objects.bulk_create(
        [ActivityDay(student_id=s, day=d) for s, d in found], ignore_conflicts=True,
    )
