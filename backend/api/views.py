import json
import secrets
from functools import reduce
from operator import or_

from django.contrib.auth.hashers import make_password
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import mixins, viewsets, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.views import APIView
from .models import MAX_LATEX_LENGTH, Account, AnswerComment, Assignment, AuthToken, BankTask, LessonFile, Homework, HomeworkFile, Payment, StudentHomework, StudentHomeworkFile, TypingResult
from .permissions import IsStudent, IsTeacher
from .photo_latex import PhotoLatexError, photo_to_latex
from .uploads import check_student_quota, check_uploads
from .serializers import (
    AccountSerializer,
    AssignmentSerializer,
    BankTaskSerializer,
    LessonFileSerializer,
    HomeworkSerializer,
    HomeworkFileSerializer,
    PaymentSerializer,
    StudentHomeworkSerializer,
    AnswerCommentSerializer,
    TypingResultSerializer,
    clean_numbered_tasks,
)


# Без похожих символов (l/1, o/0), чтобы пароль легко было продиктовать
PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
GENERATED_PASSWORD_LENGTH = 10


def _parse_json(raw):
    """Поля из multipart приходят JSON-строкой, из JSON-запроса — уже готовым объектом"""
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return None
    return raw


def _task_uploads(request, prefix):
    """Файлы к номерам заданий приходят полями «<prefix>_<номер>»: [(номер, файл), ...]"""
    uploads = []
    for key in request.FILES:
        number = key[len(prefix) + 1:] if key.startswith(prefix + '_') else ''
        if not number.isdigit() or not 1 <= int(number) <= 999:
            continue
        uploads += [(int(number), f) for f in request.FILES.getlist(key)]
    return uploads


def _file_ids(request, field):
    """Список id файлов из JSON-поля запроса; всё, что не похоже на id, отбрасываем"""
    raw = _parse_json(request.data.get(field))
    return [int(i) for i in raw if str(i).isdigit()] if isinstance(raw, list) else []


def _sync_task_files(files, numbered_tasks):
    """Файлы номеров, которых больше нет в заданиях, удаляем вместе с номером"""
    numbers = [t['number'] for t in numbered_tasks or []]
    files.filter(task_number__isnull=False).exclude(task_number__in=numbers).delete()


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

        # Имя можно вводить в любом регистре: «Иван», «иван», «ИВАН»
        candidates = Account.find_by_name(name) if name else []
        account = next((a for a in candidates if a.check_password(password)), None)
        if not candidates:
            # Тратим столько же времени, сколько на проверку пароля,
            # чтобы по скорости ответа нельзя было узнать, существует ли имя
            make_password(password)
        elif account is not None:
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

    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        """Учитель сбрасывает пароль ученику: сервер придумывает новый,
        возвращает его один раз и завершает все сессии ученика"""
        account = self.get_object()
        if account.role != 'student':
            return Response(
                {'error': 'Сбросить пароль можно только ученику'},
                status=status.HTTP_400_BAD_REQUEST
            )
        password = ''.join(secrets.choice(PASSWORD_ALPHABET) for _ in range(GENERATED_PASSWORD_LENGTH))
        account.set_password(password)
        account.save(update_fields=['password', 'updated_at'])
        account.tokens.all().delete()
        return Response({'password': password})

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
            'student_homeworks__comments__author',
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
        если пришло описание, задания (по номерам или в LaTeX) или хотя бы один файл
        (файлы без описания не теряются).
        """
        homework_data = _parse_json(request.data.get('homework'))
        if not isinstance(homework_data, dict):
            homework_data = None
        homework_files = request.FILES.getlist('homework_files')
        task_files = _task_uploads(request, 'homework_task_files')
        delete_ids = _file_ids(request, 'delete_homework_file_ids')

        # Поля, которых нет в запросе, не трогаем: None — «не прислали», '' — «очистить»
        fields = {
            key: homework_data.get(key)
            for key in ('description', 'tasks_latex')
            if homework_data and isinstance(homework_data.get(key), str)
        }
        if len(fields.get('tasks_latex', '')) > MAX_LATEX_LENGTH:
            raise ValidationError({'homework': f'Задания в LaTeX длиннее {MAX_LATEX_LENGTH} знаков'})
        if homework_data and homework_data.get('numbered_tasks') is not None:
            try:
                fields['numbered_tasks'] = clean_numbered_tasks(homework_data['numbered_tasks'])
            except ValidationError as e:
                raise ValidationError({'homework': e.detail})
        if not fields and not homework_files and not task_files and not delete_ids:
            return  # про ДЗ в запросе ничего нет — не трогаем

        homework, created = Homework.objects.get_or_create(
            assignment=assignment,
            defaults={'description': '', **fields},
        )
        changed = [key for key, value in fields.items() if getattr(homework, key) != value]
        if changed and not created:
            for key in changed:
                setattr(homework, key, fields[key])
            homework.save()

        # Фильтр по ДЗ не даёт удалить файлы чужих заданий
        homework.files.filter(id__in=delete_ids).delete()
        for f in homework_files:
            HomeworkFile.objects.create(homework=homework, name=f.name, file=f)
        for number, f in task_files:
            HomeworkFile.objects.create(homework=homework, name=f.name, file=f, task_number=number)
        _sync_task_files(homework.files, homework.numbered_tasks)

    def _save_lesson_files(self, request, assignment):
        """Прикрепляет к уроку загруженные файлы урока и файлы к номерам заданий,
        удаляет файлы, которые учитель убрал"""
        assignment.files.filter(id__in=_file_ids(request, 'delete_file_ids')).delete()
        for f in request.FILES.getlist('files'):
            LessonFile.objects.create(assignment=assignment, name=f.name, file=f)
        for number, f in _task_uploads(request, 'task_files'):
            LessonFile.objects.create(assignment=assignment, name=f.name, file=f, task_number=number)
        _sync_task_files(assignment.files, assignment.numbered_tasks)

    def _check_files(self, request):
        """Размер и тип всех файлов проверяем до того, как что-то сохранить"""
        check_uploads(
            request.FILES.getlist('files') + request.FILES.getlist('homework_files')
            + [f for _, f in _task_uploads(request, 'task_files') + _task_uploads(request, 'homework_task_files')]
        )

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
            # Ответ изменился — учителю нужно проверить его заново
            defaults={'description': description, 'status': 'pending', 'checked_at': None}
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

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        # Ученику (он попадает сюда только в переписку) доступны только свои ответы
        if not getattr(user, 'is_teacher', False):
            queryset = queryset.filter(student=user)
        return queryset

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def comments(self, request, pk=None):
        """Новое сообщение в переписке по ответу: от учителя или от автора ответа"""
        sh = self.get_object()  # чужой ответ для ученика → 404
        serializer = AnswerCommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(student_homework=sh, author=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        """Отметка учителя: сдано (accepted), не сдано (rejected) или снять отметку (pending)"""
        sh = self.get_object()
        new_status = request.data.get('status')
        if new_status not in dict(StudentHomework.STATUS_CHOICES):
            return Response(
                {'error': 'Неизвестный статус проверки'},
                status=status.HTTP_400_BAD_REQUEST
            )
        sh.status = new_status
        sh.checked_at = None if new_status == 'pending' else timezone.now()
        sh.save(update_fields=['status', 'checked_at'])
        return Response(self.get_serializer(sh).data)


class PaymentViewSet(viewsets.GenericViewSet):
    """Оплата занятий по месяцам. Видит и меняет только учитель"""
    serializer_class = PaymentSerializer
    permission_classes = [IsTeacher]

    def list(self, request):
        """Отметки за учебный год: ?school_year=2026 → сентябрь 2026 — август 2027"""
        try:
            start = int(request.query_params.get('school_year', ''))
        except ValueError:
            return Response(
                {'error': 'Укажите учебный год, например ?school_year=2026'},
                status=status.HTTP_400_BAD_REQUEST
            )
        payments = Payment.objects.filter(
            Q(year=start, month__gte=9) | Q(year=start + 1, month__lte=8)
        )
        return Response(self.get_serializer(payments, many=True).data)

    @action(detail=False, methods=['post'])
    def set(self, request):
        """Поставить (paid=true) или снять (paid=false) отметку об оплате"""
        serializer = self.get_serializer(data=request.data)
        # Уникальность пары ученик+месяц тут не проверяем: повторная отметка — не ошибка
        serializer.validators = []
        serializer.is_valid(raise_exception=True)
        key = serializer.validated_data

        if request.data.get('paid') in (True, 'true', '1', 1):
            Payment.objects.get_or_create(**key)
        else:
            Payment.objects.filter(**key).delete()
        return Response({
            'student': key['student'].id,
            'year': key['year'],
            'month': key['month'],
            'paid': Payment.objects.filter(**key).exists(),
        })


class AnswerCommentViewSet(mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Изменение и удаление сообщений в переписке.

    Изменить можно только своё сообщение. Удалить — своё, а учитель может
    удалить любое сообщение.
    """
    serializer_class = AnswerCommentSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['patch', 'delete']

    def get_queryset(self):
        queryset = AnswerComment.objects.select_related('author')
        user = self.request.user
        if not getattr(user, 'is_teacher', False):
            # ученику доступна только переписка по его собственным ответам
            queryset = queryset.filter(student_homework__student=user)
        return queryset

    def perform_update(self, serializer):
        if serializer.instance.author_id != self.request.user.pk:
            raise PermissionDenied('Изменять можно только свои сообщения')
        serializer.save(edited_at=timezone.now())

    def perform_destroy(self, instance):
        if instance.author_id != self.request.user.pk and not self.request.user.is_teacher:
            raise PermissionDenied('Удалять можно только свои сообщения')
        instance.delete()


class TypingResultViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """Результаты тренажёра печати.

    Ученик сохраняет и видит только свои результаты. Учитель видит всех:
    список с фильтром ?student=<id> и сводку по ученикам (summary).
    """
    serializer_class = TypingResultSerializer
    permission_classes = [IsAuthenticated]

    # Средние скорость и точность считаем по последним попыткам —
    # так видно, как ученик печатает сейчас, а не год назад
    RECENT_COUNT = 10

    def get_permissions(self):
        if self.action == 'create':
            return [IsStudent()]
        if self.action in ('summary', 'by_mode'):
            return [IsTeacher()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = TypingResult.objects.select_related('student')
        user = self.request.user
        if not user.is_teacher:
            return queryset.filter(student=user)
        student = self.request.query_params.get('student')
        if student:
            queryset = queryset.filter(student_id=student) if student.isdigit() else queryset.none()
        return queryset

    def perform_create(self, serializer):
        serializer.save(student=self.request.user)

    def _stats(self, results):
        """Лучший, последний и средний результат по списку попыток (от новых к старым)"""
        recent = results[:self.RECENT_COUNT]
        return {
            'tests': len(results),
            'best_wpm': max((r.wpm for r in results), default=None),
            'last_wpm': results[0].wpm if results else None,
            'avg_wpm': round(sum(r.wpm for r in recent) / len(recent)) if recent else None,
            'avg_accuracy': round(sum(r.accuracy for r in recent) / len(recent), 1) if recent else None,
            'last_at': results[0].created_at if results else None,
        }

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Сводка по каждому ученику: лучший, последний и средний результат"""
        by_student = {}
        for result in TypingResult.objects.all():  # уже от новых к старым
            by_student.setdefault(result.student_id, []).append(result)

        rows = []
        for student in Account.objects.filter(role='student'):
            rows.append({
                'student': student.id,
                'student_name': student.name,
                **self._stats(by_student.get(student.id, [])),
            })
        return Response(rows)

    @action(detail=False, methods=['get'], url_path='by-mode')
    def by_mode(self, request):
        """Статистика одного ученика по каждому режиму тренажёра: ?student=<id>.
        Режимы без попыток тоже возвращаются — с пустыми значениями."""
        student = request.query_params.get('student', '')
        if not student.isdigit():
            return Response({'error': 'Укажите ученика: ?student=<id>'}, status=status.HTTP_400_BAD_REQUEST)

        by_language = {}
        for result in TypingResult.objects.filter(student_id=student):  # от новых к старым
            by_language.setdefault(result.language, []).append(result)

        return Response([
            {'language': language, **self._stats(by_language.get(language, []))}
            for language, _ in TypingResult.LANGUAGE_CHOICES
        ])


# Картинки, которые понимает распознавание (HEIC с iPhone Pillow не открывает)
PHOTO_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif')


class BankTaskViewSet(viewsets.ModelViewSet):
    """База заданий ЕГЭ: смотрят все вошедшие, добавляет и удаляет учитель.

    Фильтр по номеру: ?number=5. Отдаём без страниц — база целиком нужна для фильтра по номерам.
    """
    serializer_class = BankTaskSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated()]
        return [IsTeacher()]

    def get_queryset(self):
        queryset = BankTask.objects.all()
        number = self.request.query_params.get('number')
        if number:
            queryset = queryset.filter(number=number) if number.isdigit() else queryset.none()
        return queryset


class PhotoLatexView(APIView):
    """Фото задания → LaTeX в стиле Spirit Code (см. api/photo_latex.py).
    POST multipart: image — картинка, number — номер для \\zadacha (по умолчанию 1)"""
    permission_classes = [IsTeacher]
    parser_classes = [MultiPartParser]
    throttle_scope = 'photo_latex'

    def post(self, request):
        image = request.FILES.get('image')
        if not image:
            return Response({'error': 'Прикрепите фото задания'}, status=status.HTTP_400_BAD_REQUEST)
        if not image.name.lower().endswith(PHOTO_EXTENSIONS):
            return Response({'error': 'Подойдут фото JPG, PNG, WEBP, BMP или GIF'}, status=status.HTTP_400_BAD_REQUEST)
        check_uploads([image])  # общий лимит размера файла

        number = request.data.get('number', '1')
        number = int(number) if str(number).isdigit() and 0 < int(number) < 1000 else 1
        try:
            return Response(photo_to_latex(image, number))
        except PhotoLatexError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
