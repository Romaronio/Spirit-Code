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
    HomeworkCreateSerializer,
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

    def create(self, request, *args, **kwargs):
        """Создание урока с возможным домашним заданием"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        assignment = serializer.save()

        homework_data = request.data.get('homework')
        if homework_data:
            if isinstance(homework_data, str):
                import json
                try:
                    homework_data = json.loads(homework_data)
                except (ValueError, TypeError):
                    homework_data = None

            if homework_data and isinstance(homework_data, dict):
                description = homework_data.get('description', '')
                homework_serializer = HomeworkCreateSerializer(
                    data={'assignment': assignment.id, 'description': description}
                )
                homework_serializer.is_valid(raise_exception=True)
                homework_serializer.save()

        files = request.data.getlist('files') if hasattr(request.data, 'getlist') else []
        for f in files:
            LessonFile.objects.create(
                assignment=assignment,
                name=f.name,
                file=f,
            )

        assignment.refresh_from_db()
        response_serializer = self.get_serializer(assignment)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        """Обновление урока с возможным домашним заданием"""
        partial = kwargs.pop('partial', False)
        instance = self.get_object()

        homework_data = request.data.get('homework')
        if homework_data is not None:
            if isinstance(homework_data, str):
                import json
                try:
                    homework_data = json.loads(homework_data)
                except (ValueError, TypeError):
                    homework_data = None

        data = request.data.copy() if hasattr(request.data, 'copy') else request.data
        if 'homework' in data:
            data.pop('homework')

        serializer = self.get_serializer(instance, data=data, partial=partial)
        serializer.is_valid(raise_exception=True)
        assignment = serializer.save()

        if homework_data and isinstance(homework_data, dict):
            try:
                homework = Homework.objects.get(assignment=assignment)
            except Homework.DoesNotExist:
                homework = None

            description = homework_data.get('description', '')
            if homework:
                homework.description = description
                homework.save()
            else:
                Homework.objects.create(assignment=assignment, description=description)

        files = request.data.getlist('files') if hasattr(request.data, 'getlist') else []
        for f in files:
            LessonFile.objects.create(
                assignment=assignment,
                name=f.name,
                file=f,
            )

        homework_files = request.data.getlist('homework_files') if hasattr(request.data, 'getlist') else []
        for f in homework_files:
            try:
                homework = Homework.objects.get(assignment=assignment)
            except Homework.DoesNotExist:
                homework = None
            if homework:
                HomeworkFile.objects.create(
                    homework=homework,
                    name=f.name,
                    file=f,
                )

        assignment.refresh_from_db()
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
