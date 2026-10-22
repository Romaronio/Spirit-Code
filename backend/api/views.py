import json
from functools import reduce
from operator import or_

from django.contrib.auth.hashers import make_password
from django.db import transaction
from django.db.models import Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from .models import Account, Assignment, AuthToken, LessonFile, Homework, HomeworkFile, StudentHomework, StudentHomeworkFile
from .permissions import IsStudent, IsTeacher
from .uploads import check_student_quota, check_uploads
from .serializers import (
    AccountSerializer,
    AssignmentSerializer,
    LessonFileSerializer,
    HomeworkSerializer,
    HomeworkFileSerializer,
    StudentHomeworkSerializer,
)


def _parse_json(raw):
    """Поля из multipart приходят JSON-строкой, из JSON-запроса — уже готовым объектом"""
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return None
    return raw


class AccountViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с аккаунтами. Управляет аккаунтами только учитель"""
    queryset = Account.objects.all()
    serializer_class = AccountSerializer
    permission_classes = [IsTeacher]
    throttle_scope = None  # лимит включается только для login (см. ниже)

    @action(
        detail=False,
        methods=['post'],
        permission_classes=[AllowAny],
        authentication_classes=[],  # старый/битый токен не должен мешать войти
        throttle_scope='login',
    )
    def login(self, request):
        """Эндпоинт для входа в систему. Возвращает токен и данные аккаунта"""
        name = str(request.data.get('name', '')).strip()
        password = str(request.data.get('password', ''))

        account = Account.objects.filter(name=name).first()
        if account is None:
            # Тратим столько же времени, сколько на проверку пароля,
            # чтобы по скорости ответа нельзя было узнать, существует ли имя
            make_password(password)
        elif account.check_password(password):
            # Заодно чистим просроченные токены этого аккаунта
            for old in account.tokens.all():
                if old.is_expired:
                    old.delete()
            token = AuthToken.issue(account)
            return Response({
                'token': token,
                'account': self.get_serializer(account).data,
            })

        return Response(
            {'error': 'Неверное имя пользователя или пароль'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated])
    def logout(self, request):
        """Выход: удаляет текущий токен"""
        if isinstance(request.auth, AuthToken):
            request.auth.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def me(self, request):
        """Данные вошедшего пользователя"""
        return Response(self.get_serializer(request.user).data)

    def destroy(self, request, *args, **kwargs):
        if self.get_object().pk == request.user.pk:
            return Response(
                {'error': 'Нельзя удалить собственный аккаунт'},
                status=status.HTTP_400_BAD_REQUEST
            )
        return super().destroy(request, *args, **kwargs)


class AssignmentViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с заданиями.

    Смотреть задания может любой вошедший (ученик — только по своим предметам),
    создавать и менять — только учитель, сдавать ответ — только ученик.
    """
    queryset = Assignment.objects.all()
    serializer_class = AssignmentSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated()]
        if self.action == 'submit':
            return [IsStudent()]
        return [IsTeacher()]

    def get_queryset(self):
        """Фильтрация заданий по предмету и по предметам ученика"""
        queryset = Assignment.objects.select_related('homework').prefetch_related(
            'files',
            'homework__files',
            'student_homeworks__files',
            'student_homeworks__student',
        )
        subject = self.request.query_params.get('subject', None)
        if subject:
            queryset = queryset.filter(subject=subject)

        user = self.request.user
        if not getattr(user, 'is_teacher', False):
            subjects = [str(s).strip() for s in (getattr(user, 'subjects', None) or []) if str(s).strip()]
            if not subjects:
                return queryset.none()
            queryset = queryset.filter(
                reduce(or_, (Q(subject__iexact=s) for s in subjects))
            )
        return queryset

    def _save_homework(self, request, assignment):
        """Создаёт или обновляет ДЗ и прикрепляет к нему загруженные файлы.

        Одинаково работает при создании и при редактировании. ДЗ создаётся,
        если пришло описание или хотя бы один файл (файлы без описания не теряются).
        """
        homework_data = _parse_json(request.data.get('homework'))
        if not isinstance(homework_data, dict):
            homework_data = None
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

    def _check_files(self, request):
        """Размер и тип всех файлов проверяем до того, как что-то сохранить"""
        check_uploads(request.FILES.getlist('files') + request.FILES.getlist('homework_files'))

    def _fresh(self, assignment):
        """Перечитываем из БД, чтобы в ответе были свежие homework и files"""
        return self.get_serializer(self.get_queryset().get(pk=assignment.pk)).data

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """Создание урока с возможным домашним заданием"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self._check_files(request)
        assignment = serializer.save()

        self._save_homework(request, assignment)
        self._save_lesson_files(request, assignment)

        return Response(self._fresh(assignment), status=status.HTTP_201_CREATED)

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
        self._check_files(request)
        assignment = serializer.save()

        self._save_homework(request, assignment)
        self._save_lesson_files(request, assignment)

        return Response(self._fresh(assignment))

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def submit(self, request, pk=None):
        """Отправка ответа учеником по заданию (всегда от имени вошедшего ученика)"""
        assignment = self.get_object()  # чужой предмет → 404
        description = request.data.get('description', '')
        files = request.FILES.getlist('files')

        # Файлы, которые ученик убрал из ответа. Фильтр по ученику и заданию
        # не даёт удалить чужие файлы.
        raw_ids = _parse_json(request.data.get('delete_file_ids'))
        delete_ids = list(
            StudentHomeworkFile.objects.filter(
                id__in=[i for i in raw_ids if str(i).isdigit()] if isinstance(raw_ids, list) else [],
                student_homework__assignment=assignment,
                student_homework__student=request.user,
            ).values_list('id', flat=True)
        )

        check_uploads(files)
        check_student_quota(request.user, files, deleted_ids=delete_ids)

        sh, created = StudentHomework.objects.update_or_create(
            assignment=assignment,
            student=request.user,
            defaults={'description': description}
        )
        StudentHomeworkFile.objects.filter(id__in=delete_ids).delete()

        for f in files:
            StudentHomeworkFile.objects.create(
                student_homework=sh,
                name=f.name,
                file=f,
            )

        sh.refresh_from_db()
        serializer = StudentHomeworkSerializer(sh, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class LessonFileViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с файлами уроков"""
    queryset = LessonFile.objects.all()
    serializer_class = LessonFileSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsTeacher]


class HomeworkViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с домашними заданиями"""
    queryset = Homework.objects.all()
    serializer_class = HomeworkSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsTeacher]


class HomeworkFileViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с файлами домашних заданий"""
    queryset = HomeworkFile.objects.all()
    serializer_class = HomeworkFileSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsTeacher]


class StudentHomeworkViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с сданными работами учеников"""
    queryset = StudentHomework.objects.all()
    serializer_class = StudentHomeworkSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsTeacher]
