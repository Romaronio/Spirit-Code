import json

from django.db import transaction
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from .models import Account, Assignment, LessonFile, Homework, HomeworkFile, StudentHomework, StudentHomeworkFile
from .serializers import (
    AccountSerializer,
    AssignmentSerializer,
    LessonFileSerializer,
    HomeworkSerializer,
    HomeworkFileSerializer,
    StudentHomeworkSerializer,
    StudentHomeworkCreateSerializer,
)


class AccountViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с аккаунтами"""
    queryset = Account.objects.all()
    serializer_class = AccountSerializer

    @action(detail=False, methods=['post'])
    def login(self, request):
        """Эндпоинт для входа в систему"""
        name = request.data.get('name')
        password = request.data.get('password')

        try:
            account = Account.objects.get(name=name, password=password)
            serializer = self.get_serializer(account)
            return Response(serializer.data)
        except Account.DoesNotExist:
            return Response(
                {'error': 'Неверное имя пользователя или пароль'},
                status=status.HTTP_401_UNAUTHORIZED
            )


class AssignmentViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с заданиями"""
    queryset = Assignment.objects.all()
    serializer_class = AssignmentSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        """Фильтрация заданий по предмету"""
        queryset = Assignment.objects.all()
        subject = self.request.query_params.get('subject', None)
        if subject:
            queryset = queryset.filter(subject=subject)
        return queryset

    @staticmethod
    def _parse_homework(raw):
        """Поле homework приходит из multipart как JSON-строка, из JSON-запроса — как dict"""
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except (ValueError, TypeError):
                return None
        return raw if isinstance(raw, dict) else None

    def _save_homework(self, request, assignment):
        """Создаёт или обновляет ДЗ и прикрепляет к нему загруженные файлы.

        Одинаково работает при создании и при редактировании. ДЗ создаётся,
        если пришло описание или хотя бы один файл (файлы без описания не теряются).
        """
        homework_data = self._parse_homework(request.data.get('homework'))
        homework_files = request.FILES.getlist('homework_files')

        description = homework_data.get('description') if homework_data else None
        if description is None and not homework_files:
            return  # про ДЗ в запросе ничего нет — не трогаем

        homework, _ = Homework.objects.get_or_create(
            assignment=assignment,
            defaults={'description': description or ''},
        )
        if description is not None and homework.description != description:
            homework.description = description
            homework.save()

        for f in homework_files:
            HomeworkFile.objects.create(homework=homework, name=f.name, file=f)

    def _save_lesson_files(self, request, assignment):
        """Прикрепляет к уроку загруженные файлы урока"""
        for f in request.FILES.getlist('files'):
            LessonFile.objects.create(assignment=assignment, name=f.name, file=f)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """Создание урока с возможным домашним заданием"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        assignment = serializer.save()

        self._save_homework(request, assignment)
        self._save_lesson_files(request, assignment)

        # Перечитываем из БД, чтобы в ответе были свежие homework и files
        assignment = Assignment.objects.get(pk=assignment.pk)
        response_serializer = self.get_serializer(assignment)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        """Обновление урока с возможным домашним заданием"""
        partial = kwargs.pop('partial', False)
        instance = self.get_object()

        # request.data не копируем: в нём лежат загруженные файлы, а их копирование
        # может падать на больших файлах. Поля homework и files в сериализаторе
        # read-only, поэтому он их и так игнорирует.
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        assignment = serializer.save()

        self._save_homework(request, assignment)
        self._save_lesson_files(request, assignment)

        assignment = Assignment.objects.get(pk=assignment.pk)
        response_serializer = self.get_serializer(assignment)
        return Response(response_serializer.data)

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """Отправка ответа учеником по заданию"""
        assignment = self.get_object()
        student_id = request.data.get('student_id')
        description = request.data.get('description', '')

        student = Account.objects.filter(id=student_id, role='student').first()
        if not student:
            return Response(
                {'error': 'Ученик не найден'},
                status=status.HTTP_400_BAD_REQUEST
            )

        sh, created = StudentHomework.objects.update_or_create(
            assignment=assignment,
            student=student,
            defaults={'description': description}
        )

        delete_file_ids = request.data.get('delete_file_ids')
        if delete_file_ids:
            if isinstance(delete_file_ids, str):
                import json
                try:
                    delete_file_ids = json.loads(delete_file_ids)
                except (ValueError, TypeError):
                    delete_file_ids = None
            if isinstance(delete_file_ids, list):
                StudentHomeworkFile.objects.filter(
                    id__in=delete_file_ids, student_homework=sh
                ).delete()

        files = request.data.getlist('files') if hasattr(request.data, 'getlist') else []
        for f in files:
            StudentHomeworkFile.objects.create(
                student_homework=sh,
                name=f.name,
                file=f,
            )

        sh.refresh_from_db()
        serializer = StudentHomeworkSerializer(sh)
        return Response(serializer.data, status=status.HTTP_200_OK if not created else status.HTTP_201_CREATED)


class LessonFileViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с файлами уроков"""
    queryset = LessonFile.objects.all()
    serializer_class = LessonFileSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]


class HomeworkViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с домашними заданиями"""
    queryset = Homework.objects.all()
    serializer_class = HomeworkSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]


class HomeworkFileViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с файлами домашних заданий"""
    queryset = HomeworkFile.objects.all()
    serializer_class = HomeworkFileSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]


class StudentHomeworkViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с сданными работами учеников"""
    queryset = StudentHomework.objects.all()
    serializer_class = StudentHomeworkSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]