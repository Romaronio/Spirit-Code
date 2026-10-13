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
    url = models.URLField()

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.assignment.title})"
