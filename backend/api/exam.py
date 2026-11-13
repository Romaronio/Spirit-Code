"""Пробник: урок с ограничением времени (Assignment.exam_minutes).

Ученик нажимает «Начать пробник» — с этого момента у него идёт свой отсчёт. До начала задания
ему не видны. Ответы сохраняются по ходу; когда время вышло или ученик нажал «Завершить», ответы
больше не меняются и он видит результат автопроверки по всем номерам.
"""
from datetime import timedelta

from django.utils import timezone

# Запас на задержку сети: ответ, отправленный в последние секунды, ещё принимается
GRACE = timedelta(seconds=30)


def is_exam(assignment):
    return bool(getattr(assignment, 'exam_minutes', None))


def exam_deadline(sh):
    """Когда у ученика заканчивается время (None — пробник не начат или урок не пробник)"""
    if sh is None or not sh.exam_started_at or not is_exam(sh.assignment):
        return None
    return sh.exam_started_at + timedelta(minutes=sh.assignment.exam_minutes)


def exam_over(sh, now=None, grace=False):
    """Пробник у ученика закончен: сдал сам или вышло время"""
    if sh is None or not sh.exam_started_at:
        return False
    if sh.exam_finished_at:
        return True
    deadline = exam_deadline(sh)
    now = now or timezone.now()
    return deadline is not None and now > deadline + (GRACE if grace else timedelta(0))


def results_visible(sh):
    """Ученик видит результат пробника: закончил и (результат сразу или учитель уже отметил работу)"""
    if not exam_over(sh):
        return False
    return sh.assignment.exam_results != 'review' or sh.status in ('accepted', 'rejected')


def finish_exam(sh):
    """Сдать пробник: время сдачи — сейчас, но не позже окончания времени"""
    if sh.exam_finished_at:
        return
    now = timezone.now()
    deadline = exam_deadline(sh)
    sh.exam_finished_at = min(now, deadline) if deadline else now
    sh.save(update_fields=['exam_finished_at'])


def hide_exam_tasks(data):
    """Пробник ещё не начат — убираем из урока задания и файлы, оставляя только их число"""
    homework = data.get('homework') or {}
    data['exam_task_count'] = len(data.get('numbered_tasks') or []) + len(homework.get('numbered_tasks') or [])
    data['numbered_tasks'] = []
    data['tasks_latex'] = ''
    data['files'] = []
    data['figures'] = []
    if data.get('homework'):
        data['homework'] = {**homework, 'numbered_tasks': [], 'tasks_latex': '', 'files': []}
    return data
