"""Автопроверка кратких ответов учеников: сравнение с ответом, который учитель указал у номера.

Ответ ученика к номеру хранится одной строкой: краткий ответ, а программа — блоком ``` в конце
(как splitTaskAnswer на фронтенде). Проверяется только краткий ответ.
"""
import re
from decimal import Decimal, InvalidOperation

CODE_BLOCK_RE = re.compile(r'^([\s\S]*?)\n?```\n([\s\S]*)\n```$')
NUMBER_RE = re.compile(r'^[+-]?(\d+([.,]\d*)?|[.,]\d+)$')


def short_answer(text):
    """Краткий ответ из сохранённого ответа к заданию (без программы)"""
    value = (text or '').replace('\r\n', '\n').replace('\r', '\n')
    match = CODE_BLOCK_RE.match(value)
    return (match.group(1) if match else value).strip()


def _tokens(value, comma_is_separator):
    """Ответ как список частей: числа — Decimal (7 = 7.0, 2,5 = 2.5), слова — без регистра, ё = е.
    comma_is_separator: «12,34» — два числа, а не дробь"""
    value = value.strip().lower().replace('ё', 'е').replace('−', '-')
    separators = r'[\s;,]+' if comma_is_separator else r'[\s;]+|,(?!\d)'
    parts = [p for p in re.split(separators, value) if p]
    result = []
    for part in parts:
        if NUMBER_RE.match(part):
            try:
                result.append(Decimal(part.replace(',', '.')))
                continue
            except InvalidOperation:
                pass
        result.append(part)
    return result


def answers_match(student, correct):
    """Совпадает ли ответ ученика с верным. В верном ответе можно указать варианты через «|».
    Пробелы, регистр, запятая или точка в дроби, «7» и «7.0» не важны; ответ из нескольких
    чисел можно разделять пробелом, запятой или точкой с запятой"""
    student = (student or '').strip()
    if not student:
        return False
    for variant in (correct or '').split('|'):
        if not variant.strip():
            continue
        for comma_is_separator in (False, True):
            if _tokens(student, comma_is_separator) == _tokens(variant, comma_is_separator):
                return True
    return False


def expected_answers(assignment):
    """Верные ответы номеров урока: {'cw-5': '42', 'hw-3': '...'}; номера без ответа не проверяются.
    Запоминается на объекте урока — сериализатор спрашивает его для каждого ученика"""
    cached = getattr(assignment, '_expected_answers', None)
    if cached is not None:
        return cached
    groups = [('cw', assignment.numbered_tasks)]
    homework = getattr(assignment, 'homework', None)
    if homework is not None:
        groups.append(('hw', homework.numbered_tasks))
    result = {
        f"{prefix}-{t['number']}": t['answer']
        for prefix, tasks in groups
        for t in tasks or []
        if (t.get('answer') or '').strip()
    }
    assignment._expected_answers = result
    return result


def task_checks(sh, for_teacher):
    """Результаты автопроверки: {'hw-5': True, 'hw-6': False}.
    Учитель видит проверку всех номеров с верным ответом по текущим ответам ученика (нет ответа — False).
    Ученик — только по номерам, которые он отправил кнопкой «Отправить ответ» и с тех пор не менял"""
    expected = expected_answers(sh.assignment)
    answers = sh.task_answers or {}
    if for_teacher:
        return {key: answers_match(short_answer(answers.get(key)), correct) for key, correct in expected.items()}
    submitted = sh.submitted_answers or {}
    result = {}
    for key, correct in expected.items():
        current = short_answer(answers.get(key))
        if key in submitted and current and submitted[key] == current:
            result[key] = answers_match(current, correct)
    return result


def snapshot_answers(sh):
    """Краткие ответы на момент «Отправить ответ» — по ним ученик видит результат проверки"""
    return {key: short for key, text in (sh.task_answers or {}).items() if (short := short_answer(text))}
