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
    ROLE_CHOICES = [
        ('teacher', 'Teacher'),
        ('student', 'Student'),
    ]

    name = models.CharField(max_length=255, unique=True)
    password = models.CharField(max_length=255)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES)
    subjects = models.JSONField(default=list, blank=True)  # список предметов для ученика

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


class Assignment(models.Model):
    """Модель для заданий"""
    title = models.CharField(max_length=255)
    subject = models.CharField(max_length=100)
    deadline = models.DateField()
    recording_url = models.URLField(blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    # Задания по номерам (например, номера заданий ЕГЭ): [{"number": 5, "latex": "..."}].
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


class LessonFile(models.Model):
    """Модель для файлов урока"""
    assignment = models.ForeignKey(
        Assignment,
        related_name='files',
        on_delete=models.CASCADE
    )
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to='lesson_files/', null=True, blank=True, validators=[validate_upload])

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


class BankTask(models.Model):
    """Задача из базы заданий ЕГЭ: номер задания в экзамене, условие в LaTeX и ответ"""
    MAX_NUMBER = 27  # номера заданий ЕГЭ: от 1 до 27

    number = models.PositiveSmallIntegerField()
    latex = models.TextField(validators=[MaxLengthValidator(MAX_LATEX_LENGTH)])
    answer = models.CharField(max_length=500, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['number', '-id']

    def __str__(self):
        return f"Задание {self.number} (#{self.id})"
