from django.db import models


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


class Assignment(models.Model):
    """Модель для заданий"""
    title = models.CharField(max_length=255)
    subject = models.CharField(max_length=100)
    deadline = models.DateField()
    recording_url = models.URLField(blank=True, null=True)
    description = models.TextField(blank=True, null=True)

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
    file = models.FileField(upload_to='lesson_files/', null=True, blank=True)

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
    file = models.FileField(upload_to='homework_files/', null=True, blank=True)

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
    file = models.FileField(upload_to='student_homework_files/', null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.student_homework.student.name})"

    @property
    def url(self):
        return self.file.url if self.file else None
