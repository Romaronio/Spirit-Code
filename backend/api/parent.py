"""Страница родителя: по секретной ссылке видно, как ученик выполняет домашние задания.

Учитель выдаёт ссылку на странице ученика (/api/accounts/<id>/parent-link/), родитель
открывает /parent/<token> без входа. Видно только название урока, срок, процент выполнения
ДЗ и отметку учителя — ни заданий, ни ответов, ни переписки.
"""
import secrets

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Account, Assignment, StudentHomework

TOKEN_BYTES = 24  # 32 знака в ссылке — не подобрать


def new_parent_token():
    return secrets.token_urlsafe(TOKEN_BYTES)


def _subjects(account):
    return {str(s).strip().casefold() for s in (account.subjects or []) if str(s).strip()}


def homework_tasks(homework):
    """Задания ДЗ, которые видит ученик (ключи как в StudentHomework.task_answers).
    Номер без текста и файлов ученику не показывается — его не считаем"""
    numbers_with_files = set(homework.files.exclude(task_number=None).values_list('task_number', flat=True))
    keys = [
        f"hw-{t['number']}" for t in homework.numbered_tasks or []
        if (t.get('latex') or '').strip() or t['number'] in numbers_with_files
    ]
    if (homework.tasks_latex or '').strip():
        keys.append('homework')
    return keys


def homework_progress(student):
    """Домашки ученика по его предметам, новые сверху: сколько заданий выполнено и отметка учителя"""
    subjects = _subjects(student)
    lessons = [
        a for a in Assignment.objects.select_related('homework').prefetch_related('homework__files')
        if any(str(s).strip().casefold() in subjects for s in a.all_subjects)
    ]
    answers = {
        sh.assignment_id: sh
        for sh in StudentHomework.objects.filter(student=student).prefetch_related('files')
    }
    rows = []
    for lesson in lessons:
        homework = getattr(lesson, 'homework', None)
        tasks = homework_tasks(homework) if homework else []
        if not tasks:
            continue  # ДЗ нет — выполнять нечего
        sh = answers.get(lesson.id)
        texts = (sh.task_answers or {}) if sh else {}
        with_files = {f.task_key for f in sh.files.all()} if sh else set()
        done = sum(1 for key in tasks if (texts.get(key) or '').strip() or key in with_files)
        rows.append({
            'id': lesson.id,
            'title': lesson.title,
            'subject': lesson.subject,
            'date': (lesson.deadline or lesson.created_at.date()).isoformat(),
            'has_deadline': lesson.deadline is not None,
            'total': len(tasks),
            'done': done,
            'percent': round(done * 100 / len(tasks)),
            # accepted — учитель отметил «Сдано», rejected — «Не сдано», null — ещё не проверено
            'review': sh.status if sh and sh.status in ('accepted', 'rejected') else None,
        })
    return rows


class ParentView(APIView):
    """GET /api/parent/<token>/ — статистика ученика для родителя, без входа"""
    permission_classes = [AllowAny]
    authentication_classes = []  # токен входа здесь не нужен (и просроченный не мешает)
    throttle_scope = 'parent'

    def get(self, request, token):
        student = Account.objects.filter(role='student', parent_token=token).first() if token else None
        if student is None:
            return Response({'error': 'Ссылка недействительна. Попросите у учителя новую.'}, status=404)
        rows = homework_progress(student)
        return Response({
            'student': student.name,
            'average': round(sum(r['percent'] for r in rows) / len(rows)) if rows else None,
            'homeworks': rows,
        })
