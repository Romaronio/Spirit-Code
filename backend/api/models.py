from django.utils.functional import cached_property
import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core.validators import MaxLengthValidator
from django.db import models
from django.utils import timezone

from .uploads import validate_upload

# Длинный конспект в LaTeX — десятки тысяч знаков; больше — уже явная ошибка
MAX_LATEX_LENGTH = 200_000
# Все задания урока по номерам вместе
MAX_TOTAL_LATEX_LENGTH = 1_000_000


class Account(models.Model):
    """Модель для учетных записей учителей и учеников"""
    # Куратор проверяет ДЗ: видит все уроки и ответы учеников, ставит отметки и пишет в переписке,
    # но не создаёт и не меняет уроки, не управляет учениками и оплатой, не ведёт созвоны
    ROLE_CHOICES = [
        ('teacher', 'Teacher'),
        ('curator', 'Curator'),
        ('student', 'Student'),
    ]

    name = models.CharField(max_length=255, unique=True)
    password = models.CharField(max_length=255)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES)
    subjects = models.JSONField(default=list, blank=True)  # список предметов для ученика
    # Создатель платформы: только он добавляет, меняет и удаляет учителей и кураторов
    # (учеников может добавлять любой учитель). Ставится миграцией 0039, через API не меняется
    is_owner = models.BooleanField(default=False)
    # Ученики, закреплённые за куратором (из любых групп). Куратор видит и проверяет только их
    students = models.ManyToManyField(
        'self', symmetrical=False, related_name='curators', blank=True,
        limit_choices_to={'role': 'student'},
    )
    # Секретная ссылка для родителей ученика (/parent/<token>): статистика домашек без входа.
    # Выдаёт учитель, новая ссылка отменяет старую. None — ссылки нет
    parent_token = models.CharField(max_length=64, unique=True, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.role})"

    # Account используется как request.user в DRF, поэтому нужен этот флаг
    @property
    def is_authenticated(self):
        return True

    @property
    def is_teacher(self):
        return self.role == 'teacher'

    @property
    def is_curator(self):
        return self.role == 'curator'

    @property
    def can_review(self):
        """Видит уроки и ответы учеников и проверяет их: учитель (всех) и куратор (своих)"""
        return self.role in ('teacher', 'curator')

    @cached_property
    def curated_ids(self):
        """id учеников, которых видит проверяющий: None — всех (учитель), у куратора — закреплённых"""
        if self.role == 'curator':
            return set(self.students.values_list('id', flat=True))
        return None

    def set_password(self, raw_password):
        """Сохраняет пароль в виде хэша (PBKDF2), а не открытым текстом"""
        self.password = make_password(raw_password)

    def check_password(self, raw_password):
        return check_password(raw_password, self.password)

    @classmethod
    def find_by_name(cls, name):
        """Аккаунты с таким именем без учёта регистра и пробелов по краям.

        Сравниваем в Python: в SQLite поиск без учёта регистра (iexact)
        работает только для латиницы, а имена бывают и на кириллице.
        """
        key = name.strip().casefold()
        return [a for a in cls.objects.all() if a.name.strip().casefold() == key]


def hash_token(key):
    return hashlib.sha256(key.encode()).hexdigest()


class AuthToken(models.Model):
    """Токен входа. В БД хранится только хэш: утечка базы не даёт войти"""
    key_hash = models.CharField(max_length=64, unique=True)
    account = models.ForeignKey(
        Account,
        related_name='tokens',
        on_delete=models.CASCADE
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Токен {self.account.name} от {self.created_at:%Y-%m-%d}"

    @classmethod
    def issue(cls, account):
        """Создаёт новый токен и возвращает его открытое значение (показывается один раз)"""
        key = secrets.token_urlsafe(32)
        cls.objects.create(account=account, key_hash=hash_token(key))
        return key

    @property
    def is_expired(self):
        return timezone.now() - self.created_at > timedelta(days=settings.AUTH_TOKEN_TTL_DAYS)


class Subject(models.Model):
    """Предмет в списках выбора: форма урока, предметы ученика, созвоны.

    Урок и ученик хранят предмет текстом, поэтому удаление предмета убирает его только
    из выбора — уроки по нему и предметы, уже назначенные ученикам, не меняются.
    """
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    @classmethod
    def ensure(cls, name):
        """Предмет с таким названием без учёта регистра; нет — создаётся.
        Сравниваем в Python: iexact в SQLite не понимает регистр русских букв"""
        name = ' '.join(str(name).split())
        if not name:
            return None
        key = name.casefold()
        for subject in cls.objects.all():
            if subject.name.casefold() == key:
                return subject
        return cls.objects.create(name=name)


class Assignment(models.Model):
    """Модель для заданий"""
    title = models.CharField(max_length=255)
    subject = models.CharField(max_length=100)
    # Ещё предметы, в которых есть этот урок (тот же урок, не копия): например, урок «Информатики»
    # добавили в «ЕГЭ информатика». Ученик видит урок, если у него есть любой из предметов
    extra_subjects = models.JSONField(blank=True, default=list)
    deadline = models.DateField(blank=True, null=True)
    recording_url = models.URLField(blank=True, null=True)
    # Описание урока больше нигде не показывается и не приходит в API; старые тексты лежат здесь
    description = models.TextField(blank=True, null=True)
    # Задания по номерам (например, номера заданий ЕГЭ): [{"number": 5, "latex": "...", "answer": "..."}].
    # Ответ видит только учитель.
    # У каждого номера своя кнопка и свой документ
    numbered_tasks = models.JSONField(blank=True, default=list)
    # Задания классной работы в LaTeX без номера — ученик открывает их прямо на сайте
    tasks_latex = models.TextField(blank=True, default='', validators=[MaxLengthValidator(MAX_LATEX_LENGTH)])

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-id']

    def __str__(self):
        return f"{self.title} - {self.subject}"

    @property
    def all_subjects(self):
        return [self.subject, *(self.extra_subjects or [])]


class LessonFile(models.Model):
    """Модель для файлов урока"""
    assignment = models.ForeignKey(
        Assignment,
        related_name='files',
        on_delete=models.CASCADE
    )
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to='lesson_files/', null=True, blank=True, validators=[validate_upload])
    # Файл к конкретному номеру задания (например, 24.txt); None — общий файл урока
    task_number = models.PositiveSmallIntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.assignment.title})"

    @property
    def url(self):
        """Возвращает URL файла для совместимости с frontend"""
        return self.file.url if self.file else None


class Homework(models.Model):
    """Модель для домашних заданий"""
    assignment = models.OneToOneField(
        Assignment,
        related_name='homework',
        on_delete=models.CASCADE
    )
    # Описание ДЗ больше нигде не показывается и не приходит в API; старые тексты лежат здесь
    description = models.TextField()
    # Задания ДЗ по номерам — как у классной работы: [{"number": 5, "latex": "..."}]
    numbered_tasks = models.JSONField(blank=True, default=list)
    # Задания ДЗ в LaTeX — ученик открывает их прямо на сайте
    tasks_latex = models.TextField(blank=True, default='', validators=[MaxLengthValidator(MAX_LATEX_LENGTH)])

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"ДЗ: {self.assignment.title}"


class HomeworkFile(models.Model):
    """Модель для файлов домашнего задания"""
    homework = models.ForeignKey(
        Homework,
        related_name='files',
        on_delete=models.CASCADE
    )
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to='homework_files/', null=True, blank=True, validators=[validate_upload])
    # Файл к конкретному номеру задания ДЗ; None — общий файл ДЗ
    task_number = models.PositiveSmallIntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} (ДЗ: {self.homework.assignment.title})"

    @property
    def url(self):
        """Возвращает URL файла для совместимости с frontend"""
        return self.file.url if self.file else None


class StudentHomework(models.Model):
    """Сданная работа ученика по заданию"""
    STATUS_CHOICES = [
        ('pending', 'На проверке'),
        ('accepted', 'Сдано'),
        ('rejected', 'Не сдано'),
    ]

    assignment = models.ForeignKey(
        Assignment,
        related_name='student_homeworks',
        on_delete=models.CASCADE
    )
    student = models.ForeignKey(
        Account,
        related_name='student_homeworks',
        on_delete=models.CASCADE
    )
    description = models.TextField(blank=True, default='')
    # Ответы к отдельным заданиям: {"cw-5": "текст", "hw-3": "...", "classwork": "...", "homework": "..."}
    # cw-N — номер классной работы, hw-N — номер ДЗ, classwork/homework — задания без номера
    task_answers = models.JSONField(blank=True, default=dict)
    # Краткие ответы на момент «Отправить ответ»: {"hw-5": "42"}. Результат автопроверки ученик
    # видит только по ним — и только пока не изменил ответ (см. answer_check.task_checks)
    submitted_answers = models.JSONField(blank=True, default=dict)
    submitted_at = models.DateTimeField(auto_now_add=True)
    # Отметка учителя после проверки
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    checked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-submitted_at']
        unique_together = ['assignment', 'student']

    def __str__(self):
        return f"{self.student.name} — {self.assignment.title}"


class StudentHomeworkFile(models.Model):
    """Файлы, прикреплённые учеником к сданной работе"""
    student_homework = models.ForeignKey(
        StudentHomework,
        related_name='files',
        on_delete=models.CASCADE
    )
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to='student_homework_files/', null=True, blank=True, validators=[validate_upload])
    # Файл к ответу на конкретное задание (ключ как в StudentHomework.task_answers); '' — общий файл ответа
    task_key = models.CharField(max_length=20, blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.student_homework.student.name})"

    @property
    def url(self):
        return self.file.url if self.file else None


class Payment(models.Model):
    """Отметка учителя «ученик оплатил занятия за месяц».

    Есть запись — оплачено, нет записи — не оплачено.
    """
    student = models.ForeignKey(
        Account,
        related_name='payments',
        on_delete=models.CASCADE
    )
    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()  # 1–12
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['year', 'month']
        unique_together = ['student', 'year', 'month']

    def __str__(self):
        return f"{self.student.name}: {self.month:02d}.{self.year}"


class AnswerComment(models.Model):
    """Сообщение в переписке по ответу ученика (пишут учитель и сам ученик)"""
    student_homework = models.ForeignKey(
        StudentHomework,
        related_name='comments',
        on_delete=models.CASCADE
    )
    author = models.ForeignKey(
        Account,
        related_name='answer_comments',
        on_delete=models.CASCADE
    )
    text = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)  # когда автор менял текст

    class Meta:
        ordering = ['created_at', 'id']

    def __str__(self):
        return f"{self.author.name}: {self.text[:30]}"


class TypingResult(models.Model):
    """Результат одного теста в тренажёре печати.

    Клиент присылает сырые счётчики, скорость и точность считает сервер.
    """
    LANGUAGE_CHOICES = [
        ('ru', 'Русский'),
        ('en', 'Английский'),
        ('ege', 'ЕГЭ (Python), лёгкий'),
        ('ege_hard', 'ЕГЭ (Python), сложный'),
    ]
    PHRASE_LANGUAGES = ['ege_hard']  # набираются строки кода, а не отдельные слова
    DURATIONS = [30, 60, 120]  # длительность теста в секундах

    student = models.ForeignKey(
        Account,
        related_name='typing_results',
        on_delete=models.CASCADE
    )
    language = models.CharField(max_length=10, choices=LANGUAGE_CHOICES, default='ru')
    duration = models.PositiveSmallIntegerField()
    correct_words = models.PositiveIntegerField()  # слов (строк кода) набрано без ошибок
    correct_chars = models.PositiveIntegerField()  # знаков в этих словах (с пробелами)
    keystrokes = models.PositiveIntegerField()     # всего нажатий
    errors = models.PositiveIntegerField()         # слов, отправленных с ошибкой
    wpm = models.PositiveSmallIntegerField()       # слов в минуту
    cpm = models.PositiveSmallIntegerField()       # знаков в минуту
    accuracy = models.FloatField()                 # доля верных слов, %
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f"{self.student.name}: {self.wpm} сл/мин"


class Call(models.Model):
    """Созвон-урок в LiveKit. Идёт, пока учитель не завершит его (или не истечёт MAX_DURATION).

    Подключиться могут учитель и ученики с предметом созвона или одним из extra_subjects;
    пустой предмет — все ученики.
    Если выбран student — это личный урок: из учеников его видит только он.
    assignment — урок, задания которого открыты в созвоне; shown_task — задание, которое учитель
    показал ученикам (ключ как в StudentHomework.task_answers: cw-5, hw-3, classwork, homework).
    """
    MAX_DURATION = timedelta(hours=6)  # забытый незавершённый созвон дольше не показываем

    title = models.CharField(max_length=255, blank=True, default='')
    subject = models.CharField(max_length=100, blank=True, default='')
    extra_subjects = models.JSONField(blank=True, default=list)
    student = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='personal_calls',
    )
    started_by = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='calls',
    )
    assignment = models.ForeignKey(
        Assignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='calls',
    )
    shown_task = models.CharField(max_length=20, blank=True, default='')
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        return f"Созвон #{self.id} {self.student or self.subject or 'все'}"

    @property
    def all_subjects(self):
        return [self.subject, *(self.extra_subjects or [])]

    @property
    def room_name(self):
        return f'spirit-call-{self.id}'


class CallAnswer(models.Model):
    """Ответ ученика к заданию прямо на уроке в созвоне.

    Хранится отдельно от работы ученика по уроку (StudentHomework): в ДЗ не идёт
    и проверки учителя не ждёт. Видят его сам ученик и учитель.
    """
    call = models.ForeignKey(Call, on_delete=models.CASCADE, related_name='answers')
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name='call_answers')
    student = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='call_answers')
    task = models.CharField(max_length=20)  # ключ как в StudentHomework.task_answers
    text = models.TextField(blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['updated_at']
        constraints = [
            models.UniqueConstraint(fields=['call', 'assignment', 'student', 'task'], name='unique_call_answer'),
        ]

    def __str__(self):
        return f"Ответ на уроке {self.student.name} · {self.task}"


class CallAnswerFile(models.Model):
    """Файл к ответу на уроке"""
    answer = models.ForeignKey(CallAnswer, on_delete=models.CASCADE, related_name='files')
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to='call_answer_files/', null=True, blank=True, validators=[validate_upload])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class TikzFigure(models.Model):
    """Рисунок TikZ из задания, собранный в SVG (см. api/tikz.py).

    Ищется по хэшу текста рисунка, а не привязан к уроку: при копировании задания
    или повторном сохранении ничего не собирается заново.
    """
    PENDING, READY, ERROR = 'pending', 'ok', 'error'
    STATUSES = [(PENDING, 'Ждёт сборки'), (READY, 'Готов'), (ERROR, 'Ошибка')]

    key = models.CharField(max_length=64, unique=True)
    source = models.TextField()
    status = models.CharField(max_length=10, choices=STATUSES, default=PENDING)
    svg = models.FileField(upload_to='tikz/', blank=True)
    error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.key[:8]} ({self.status})'


class DataVersion(models.Model):
    """Номер версии данных: растёт при любом изменении уроков, ДЗ, ответов, переписки и учеников.

    Страницы раз в несколько секунд спрашивают только этот номер (GET /api/updates/) и
    перезагружают данные, когда он сменился, — так новое видно без обновления страницы.
    Одна строка в БД, а не кэш: у gunicorn несколько процессов, кэш в памяти у каждого свой.
    """
    value = models.PositiveBigIntegerField(default=0)

    @classmethod
    def bump(cls):
        if not cls.objects.filter(pk=1).update(value=models.F('value') + 1):
            cls.objects.get_or_create(pk=1, defaults={'value': 1})

    @classmethod
    def current(cls):
        return cls.objects.filter(pk=1).values_list('value', flat=True).first() or 0


class PushKeys(models.Model):
    """Ключи сайта для push-уведомлений (VAPID). Создаются сами при первом обращении (api/push.py)"""
    private_pem = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)


class PushSubscription(models.Model):
    """Подписка браузера на уведомления: телефон, компьютер — у каждого своя"""
    account = models.ForeignKey(Account, related_name='push_subscriptions', on_delete=models.CASCADE)
    endpoint = models.URLField(max_length=1000, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Push: {self.account.name}"
