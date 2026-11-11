import json
import re
import secrets

from django.conf import settings
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
from .answer_check import snapshot_answers
from .models import MAX_LATEX_LENGTH, Account, AnswerComment, Assignment, AuthToken, Call, CallAnswer, CallAnswerFile, DataVersion, LessonFile, PushSubscription, Subject, Homework, HomeworkFile, Payment, StudentHomework, StudentHomeworkFile, TypingResult
from . import livekit, push
from .parent import new_parent_token
from .topics import clean_topic
from .streak import mark_active, streak_info
from .permissions import IsReviewer, IsStudent, IsTeacher
from .photo_latex import PhotoLatexError, photo_to_latex
from .uploads import check_student_quota, check_uploads
from .serializers import (
    AccountSerializer,
    AssignmentSerializer,
    CallAnswerSerializer,
    CallSerializer,
    LessonFileSerializer,
    HomeworkSerializer,
    HomeworkFileSerializer,
    PaymentSerializer,
    StudentHomeworkSerializer,
    SubjectSerializer,
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


MAX_TASK_ANSWER_TEXT = 20000  # ответ и программа к заданию


def _task_keys(assignment):
    """Задания урока, к которым ученик может прислать ответ (ключи как в StudentHomework.task_answers)"""
    keys = {f"cw-{t['number']}" for t in assignment.numbered_tasks or []}
    if (assignment.tasks_latex or '').strip():
        keys.add('classwork')
    homework = getattr(assignment, 'homework', None)
    if homework is not None:
        keys |= {f"hw-{t['number']}" for t in homework.numbered_tasks or []}
        if (homework.tasks_latex or '').strip():
            keys.add('homework')
    return keys


def _has_detailed_answer(sh, key):
    """Развёрнутый ответ к заданию: программа (блок ``` в ответе) или файл к этому заданию"""
    text = ((sh.task_answers or {}).get(key) or '').replace('\r\n', '\n') if sh else ''
    match = re.match(r'^[\s\S]*?\n?```\n([\s\S]*)\n```$', text)
    if match and match.group(1).strip():
        return True
    return bool(sh) and sh.files.filter(task_key=key).exists()


def _missing_detailed_answers(assignment, sh):
    """Номера ДЗ с обязательным развёрнутым ответом, к которым ученик его не прикрепил.
    Классную работу можно не решать, чтобы отправить урок. Номер без текста и файлов
    ученик не видит — его не требуем"""
    homework = getattr(assignment, 'homework', None)
    if homework is None:
        return []
    missing = []
    for t in homework.numbered_tasks or []:
        if not t.get('detailed_required') or t.get('short_only'):
            continue
        number = t['number']
        shown = (t.get('latex') or '').strip() or homework.files.filter(task_number=number).exists()
        if shown and not _has_detailed_answer(sh, f'hw-{number}'):
            missing.append(f'{number} (дз)')
    return missing


def _is_empty_answer(sh):
    """В ответе ученика ничего нет: ни текста, ни ответов к заданиям, ни файлов, ни переписки"""
    return (
        not (sh.description or '').strip()
        and not sh.task_answers
        and not sh.files.exists()
        and not sh.comments.exists()
    )


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

    def get_permissions(self):
        # Куратору нужен список учеников, чтобы видеть, кто прислал ответ; менять аккаунты он не может
        if self.action in ('list', 'retrieve'):
            return [IsReviewer()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = Account.objects.prefetch_related('students')
        user = self.request.user
        if getattr(user, 'curated_ids', None) is not None:
            # Куратор видит только себя и закреплённых за ним учеников
            return queryset.filter(Q(id__in=user.curated_ids) | Q(id=user.id))
        return queryset

    def _check_owner(self, *roles):
        """Учителей и кураторов добавляет, меняет и удаляет только создатель платформы,
        учеников — любой учитель"""
        if any(role != 'student' for role in roles) and not self.request.user.is_owner:
            raise PermissionDenied('Учителей и кураторов может добавлять и менять только создатель платформы')

    def perform_create(self, serializer):
        self._check_owner(serializer.validated_data.get('role', ''))
        serializer.save()

    def perform_update(self, serializer):
        account = serializer.instance
        self._check_owner(account.role, serializer.validated_data.get('role', account.role))
        if account.is_owner and serializer.validated_data.get('role', account.role) != account.role:
            raise PermissionDenied('Создатель платформы остаётся учителем')
        serializer.save()

    @action(detail=True, methods=['get', 'post'], url_path='parent-link')
    def parent_link(self, request, pk=None):
        """Ссылка для родителей ученика. GET — текущая (при первом запросе создаётся),
        POST — новая: старая сразу перестаёт работать"""
        student = self.get_object()
        if student.role != 'student':
            raise ValidationError({'detail': ['Ссылка для родителей есть только у ученика']})
        if request.method == 'POST' or not student.parent_token:
            student.parent_token = new_parent_token()
            student.save(update_fields=['parent_token'])
        return Response({'token': student.parent_token})

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

    @action(detail=False, methods=['get'], permission_classes=[IsStudent])
    def streak(self, request):
        """Серия дней ученика: {current, best, active_today, week}"""
        return Response(streak_info(request.user))

    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        """Учитель сбрасывает пароль ученику или куратору: сервер придумывает новый,
        возвращает его один раз и завершает все сессии этого аккаунта"""
        account = self.get_object()
        if account.pk == request.user.pk:
            return Response(
                {'error': 'Свой пароль сбросить нельзя'},
                status=status.HTTP_400_BAD_REQUEST
            )
        self._check_owner(account.role)
        password = ''.join(secrets.choice(PASSWORD_ALPHABET) for _ in range(GENERATED_PASSWORD_LENGTH))
        account.set_password(password)
        account.save(update_fields=['password', 'updated_at'])
        account.tokens.all().delete()
        return Response({'password': password})

    def destroy(self, request, *args, **kwargs):
        account = self.get_object()
        if account.pk == request.user.pk:
            return Response(
                {'error': 'Нельзя удалить собственный аккаунт'},
                status=status.HTTP_400_BAD_REQUEST
            )
        self._check_owner(account.role)
        if account.is_owner:
            raise PermissionDenied('Аккаунт создателя платформы удалить нельзя')
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
        if self.action in ('submit', 'submit_task'):
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
        if getattr(user, 'own_lessons_only', False):
            # Учитель (не создатель платформы) — только свои уроки
            queryset = queryset.filter(created_by=user)
        elif getattr(user, 'curated_ids', None) is not None:
            # Куратор видит уроки своих учеников: по их предметам и те, к которым они прислали ответ
            students = Account.objects.filter(id__in=user.curated_ids)
            subjects = {str(s).strip().casefold() for st in students for s in (st.subjects or []) if str(s).strip()}
            ids = [
                a.id for a in Assignment.objects.only('id', 'subject', 'extra_subjects')
                if any(str(s).strip().casefold() in subjects for s in a.all_subjects)
            ]
            ids += StudentHomework.objects.filter(student_id__in=user.curated_ids).values_list('assignment_id', flat=True)
            queryset = queryset.filter(id__in=ids)
        elif not getattr(user, 'can_review', False):
            subjects = {str(s).strip().casefold() for s in (getattr(user, 'subjects', None) or []) if str(s).strip()}
            # Урок виден, если любой из его предметов есть у ученика. Сравниваем в Python:
            # дополнительные предметы лежат в JSON, а iexact в SQLite не понимает регистр русских букв
            ids = [
                a.id for a in Assignment.objects.only('id', 'subject', 'extra_subjects')
                if any(str(s).strip().casefold() in subjects for s in a.all_subjects)
            ]
            # В общем созвоне учитель может открыть урок и не из предметов этого ученика
            if self.action == 'retrieve':
                ids += [c.assignment_id for c in _student_calls(user) if c.assignment_id]
            queryset = queryset.filter(id__in=ids)
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
            for key in ('tasks_latex',)  # описание ДЗ больше не принимается
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

    @action(detail=False, methods=['post'])
    @transaction.atomic
    def reorder(self, request):
        """Порядок уроков в папке-теме: {topic: «№26», ids: [id, ...]} — уроки встают в тему
        в этом порядке (так же урок переносят в другую тему). Только учитель"""
        topic = clean_topic(request.data.get('topic'))
        ids = request.data.get('ids')
        if not isinstance(ids, list) or not ids or not all(isinstance(i, int) for i in ids) or len(ids) > 500:
            raise ValidationError({'ids': ['Нужен список уроков']})
        if len(set(ids)) != len(ids) or self.get_queryset().filter(id__in=ids).count() != len(ids):
            raise ValidationError({'ids': ['Таких уроков нет']})
        # update(), а не save(): не пересобираем рисунки TikZ ради перестановки
        for position, lesson_id in enumerate(ids, start=1):
            Assignment.objects.filter(id=lesson_id).update(topic=topic, position=position)
        DataVersion.bump()
        return Response({'topic': topic, 'ids': ids})

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """Создание урока с возможным домашним заданием"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self._check_files(request)
        assignment = serializer.save(created_by=request.user)
        for name in assignment.all_subjects:  # новый предмет появляется в списках выбора
            Subject.ensure(name, request.user)

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
        for name in assignment.all_subjects:  # урок перенесли в новый предмет — он появляется в списках
            Subject.ensure(name, request.user)

        self._save_homework(request, assignment)
        self._save_lesson_files(request, assignment)

        return Response(self._fresh(assignment))

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def submit(self, request, pk=None):
        """Отправка ответа учеником по заданию (всегда от имени вошедшего ученика)"""
        assignment = self.get_object()  # чужой предмет → 404
        files = request.FILES.getlist('files')

        # Учитель отметил номера, где развёрнутый ответ обязателен, — без него ДЗ не отправить
        existing = StudentHomework.objects.filter(assignment=assignment, student=request.user).first()
        missing = _missing_detailed_answers(assignment, existing)
        if missing:
            raise ValidationError({'detail': [
                'У вас не прикреплён развёрнутый ответ к номеру: ' + ', '.join(missing)
                + '. Вставьте программу или прикрепите файл в окне номера.'
            ]})

        # Файлы, которые ученик убрал из ответа. Фильтр по ученику и заданию
        # не даёт удалить чужие файлы.
        raw_ids = _parse_json(request.data.get('delete_file_ids'))
        delete_ids = list(
            StudentHomeworkFile.objects.filter(
                id__in=[i for i in raw_ids if str(i).isdigit()] if isinstance(raw_ids, list) else [],
                student_homework__assignment=assignment,
                student_homework__student=request.user,
                task_key='',
            ).values_list('id', flat=True)
        )

        check_uploads(files)
        check_student_quota(request.user, files, deleted_ids=delete_ids)

        # Ответ изменился — учителю нужно проверить его заново.
        # Описания работы в форме ученика больше нет: без него старое описание не стираем
        defaults = {'status': 'pending', 'checked_at': None}
        if 'description' in request.data:
            defaults['description'] = request.data.get('description', '')
        sh, created = StudentHomework.objects.update_or_create(
            assignment=assignment,
            student=request.user,
            defaults=defaults,
        )
        StudentHomeworkFile.objects.filter(id__in=delete_ids).delete()

        for f in files:
            StudentHomeworkFile.objects.create(
                student_homework=sh,
                name=f.name,
                file=f,
            )

        if _is_empty_answer(sh):
            sh.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # Отправленные краткие ответы — по ним ученик теперь видит результат автопроверки
        sh.submitted_answers = snapshot_answers(sh)
        sh.save(update_fields=['submitted_answers'])
        mark_active(request.user)

        sh.refresh_from_db()
        serializer = StudentHomeworkSerializer(sh, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='submit-task')
    @transaction.atomic
    def submit_task(self, request, pk=None):
        """Ответ ученика к одному заданию урока: текст и файлы.
        Хранится в общей работе ученика по уроку — статус и переписка у урока общие"""
        assignment = self.get_object()  # чужой предмет → 404
        task = str(request.data.get('task', ''))
        if task not in _task_keys(assignment):
            raise ValidationError({'task': ['Такого задания нет в уроке']})
        # Браузер отправляет переводы строк формы как \r\n — храним обычные \n
        text = str(request.data.get('text', '')).replace('\r\n', '\n').strip()
        if len(text) > MAX_TASK_ANSWER_TEXT:
            raise ValidationError({'text': [f'Ответ длиннее {MAX_TASK_ANSWER_TEXT} знаков']})
        files = request.FILES.getlist('files')

        raw_ids = _parse_json(request.data.get('delete_file_ids'))
        delete_ids = list(
            StudentHomeworkFile.objects.filter(
                id__in=[i for i in raw_ids if str(i).isdigit()] if isinstance(raw_ids, list) else [],
                student_homework__assignment=assignment,
                student_homework__student=request.user,
                task_key=task,
            ).values_list('id', flat=True)
        )

        check_uploads(files)
        check_student_quota(request.user, files, deleted_ids=delete_ids)

        sh, created = StudentHomework.objects.select_for_update().get_or_create(
            assignment=assignment,
            student=request.user,
        )
        answers = dict(sh.task_answers or {})
        if text:
            answers[task] = text
        else:
            answers.pop(task, None)
        sh.task_answers = answers
        if task == 'classwork' or task.startswith('cw-'):
            # Классную работу можно не решать, учитель её не проверяет — отметка урока остаётся
            sh.save(update_fields=['task_answers'])
        else:
            # Ответ к ДЗ изменился — учителю нужно проверить его заново
            sh.status = 'pending'
            sh.checked_at = None
            sh.save(update_fields=['task_answers', 'status', 'checked_at'])

        StudentHomeworkFile.objects.filter(id__in=delete_ids).delete()
        for f in files:
            StudentHomeworkFile.objects.create(student_homework=sh, name=f.name, file=f, task_key=task)
        mark_active(request.user)

        # Ученик стёр всё, что написал, — пустой ответ учителю проверять нечего
        if _is_empty_answer(sh):
            sh.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        sh.refresh_from_db()
        serializer = StudentHomeworkSerializer(sh, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class LessonFileViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с файлами уроков"""
    queryset = LessonFile.objects.all()
    serializer_class = LessonFileSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsTeacher]

    def get_queryset(self):
        return _own_lessons(super().get_queryset(), self.request.user, 'assignment__created_by')


class HomeworkViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с домашними заданиями"""
    queryset = Homework.objects.all()
    serializer_class = HomeworkSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsTeacher]

    def get_queryset(self):
        return _own_lessons(super().get_queryset(), self.request.user, 'assignment__created_by')


class HomeworkFileViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с файлами домашних заданий"""
    queryset = HomeworkFile.objects.all()
    serializer_class = HomeworkFileSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsTeacher]

    def get_queryset(self):
        return _own_lessons(super().get_queryset(), self.request.user, 'homework__assignment__created_by')


class StudentHomeworkViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с сданными работами учеников"""
    queryset = StudentHomework.objects.all()
    serializer_class = StudentHomeworkSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsReviewer]  # учитель и куратор проверяют ответы

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        # Ученику (он попадает сюда только в переписку) доступны только свои ответы,
        # куратору — ответы закреплённых за ним учеников
        if not getattr(user, 'can_review', False):
            queryset = queryset.filter(student=user)
        elif user.curated_ids is not None:
            queryset = queryset.filter(student_id__in=user.curated_ids)
        return _own_lessons(queryset, user, 'assignment__created_by')

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def comments(self, request, pk=None):
        """Новое сообщение в переписке по ответу: от учителя или от автора ответа"""
        sh = self.get_object()  # чужой ответ для ученика → 404
        serializer = AnswerCommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(student_homework=sh, author=request.user)
        mark_active(request.user)
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


class SubjectViewSet(mixins.ListModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Предметы в списках выбора. GET — список, POST {name} — добавить (такой уже есть —
    вернётся он), DELETE — убрать из выбора; уроки и ученики не меняются. Только учитель"""
    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer
    permission_classes = [IsTeacher]
    pagination_class = None

    def get_permissions(self):
        if self.action == 'list':  # куратору — только посмотреть список
            return [IsReviewer()]
        return super().get_permissions()

    def create(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subject = Subject.ensure(serializer.validated_data['name'], request.user)
        return Response(SubjectSerializer(subject).data, status=status.HTTP_201_CREATED)


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
        if not getattr(user, 'can_review', False):
            # ученику доступна только переписка по его собственным ответам
            queryset = queryset.filter(student_homework__student=user)
        elif user.curated_ids is not None:
            queryset = queryset.filter(student_homework__student_id__in=user.curated_ids)
        return _own_lessons(queryset, user, 'student_homework__assignment__created_by')

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
            return [IsReviewer()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = TypingResult.objects.select_related('student')
        user = self.request.user
        if not user.can_review:
            return queryset.filter(student=user)
        if user.curated_ids is not None:
            queryset = queryset.filter(student_id__in=user.curated_ids)
        student = self.request.query_params.get('student')
        if student:
            queryset = queryset.filter(student_id=student) if student.isdigit() else queryset.none()
        return queryset

    def perform_create(self, serializer):
        serializer.save(student=self.request.user)
        mark_active(self.request.user)

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
        students = Account.objects.filter(role='student')
        if request.user.curated_ids is not None:
            students = students.filter(id__in=request.user.curated_ids)
        for student in students:
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
        if request.user.curated_ids is not None and int(student) not in request.user.curated_ids:
            return Response({'error': 'Этот ученик не закреплён за вами'}, status=status.HTTP_404_NOT_FOUND)

        by_language = {}
        for result in TypingResult.objects.filter(student_id=student):  # от новых к старым
            by_language.setdefault(result.language, []).append(result)

        return Response([
            {'language': language, **self._stats(by_language.get(language, []))}
            for language, _ in TypingResult.LANGUAGE_CHOICES
        ])


# Картинки, которые понимает распознавание (HEIC с iPhone Pillow не открывает)
PHOTO_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif')


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


def _calls_open_for(user):
    """Открыты ли созвоны ученику (settings.CALLS_STUDENTS: имена или «*»)"""
    allowed = {name.casefold() for name in settings.CALLS_STUDENTS}
    return '*' in allowed or user.name.casefold() in allowed


def _live_calls():
    return Call.objects.select_related('started_by', 'student', 'assignment').filter(
        ended_at__isnull=True,
        started_at__gte=timezone.now() - Call.MAX_DURATION,
    )


def _call_recipients(call):
    """Ученики, которые могут войти в этот созвон (как в _student_calls)"""
    if call.student_id:
        return [call.student]
    result = []
    for student in Account.objects.filter(role='student'):
        if not _calls_open_for(student):
            continue
        subjects = {str(s).strip().casefold() for s in (student.subjects or [])}
        if not call.subject or any(s.strip().casefold() in subjects for s in call.all_subjects):
            result.append(student)
    return result


def _notify_call_started(call):
    """Push ученикам: начался урок — нажать и подключиться"""
    name = call.title or (call.assignment.title if call.assignment_id else '') or call.subject or 'Онлайн-урок'
    teacher = call.started_by.name if call.started_by_id else 'Учитель'
    push.send_to(
        _call_recipients(call),
        title=f'Начался урок: {name}',
        body=f'{teacher} начал(а) урок — нажмите, чтобы подключиться',
        url=f'/call/{call.id}',
    )


def _own_lessons(queryset, user, field):
    """Учителю, кроме создателя платформы, — только то, что относится к его урокам"""
    if getattr(user, 'own_lessons_only', False):
        return queryset.filter(**{field: user})
    return queryset


def _student_calls(user):
    """Идущие созвоны, в которые может войти ученик"""
    queryset = _live_calls()
    # Личный урок учитель начал сам для этого ученика — он виден и при закрытых CALLS_STUDENTS
    personal = queryset.filter(student=user)
    if not _calls_open_for(user):
        return personal
    # Сравниваем в Python: iexact в SQLite не понимает регистр русских букв.
    # Идущих созвонов единицы, так что это дёшево
    subjects = {str(s).strip().casefold() for s in (getattr(user, 'subjects', None) or [])}
    ids = [
        c.id for c in queryset
        if c.student_id == user.id or (
            not c.student_id and (not c.subject or any(s.casefold() in subjects for s in c.all_subjects))
        )
    ]
    return queryset.filter(id__in=ids)


class CallViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Созвоны-уроки (LiveKit).

    GET /calls/ — идущие созвоны: учителю все, ученику — личные с ним и по его предметам (и общие, без предмета).
    POST /calls/ — учитель начинает созвон {subject, extra_subjects, title} или личный {student, title}.
    POST /calls/{id}/join/ — токен LiveKit для входа в комнату.
    POST /calls/{id}/end/ — учитель завершает созвон для всех.
    POST /calls/{id}/show/ — учитель выбирает урок и задание, которое видят ученики {assignment, task}.
    GET /calls/{id}/answers/ — ответы на уроке к открытому уроку: учителю всех, ученику свои.
    POST /calls/{id}/answer/ — ученик сохраняет ответ к заданию {task, text, files, delete_file_ids}.
    Ответы на уроке хранятся отдельно от работы по уроку: в ДЗ не идут и проверки не ждут.
    """
    serializer_class = CallSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ('create', 'end', 'show'):
            return [IsTeacher()]
        if self.action == 'answer':
            return [IsStudent()]
        return [IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        if getattr(user, 'is_curator', False):
            return Call.objects.none()  # созвоны ведёт учитель, куратор в них не участвует
        return _live_calls() if getattr(user, 'is_teacher', False) else _student_calls(user)

    def perform_create(self, serializer):
        call = serializer.save(started_by=self.request.user)
        _notify_call_started(call)

    @action(detail=True, methods=['post'])
    def join(self, request, pk=None):
        call = self.get_object()
        user = request.user
        try:
            token = livekit.make_token(
                identity=f'account-{user.id}',
                name=user.name,
                room=call.room_name,
                is_admin=user.is_teacher,
            )
        except livekit.LiveKitNotConfigured as e:
            return Response({'error': str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({
            'call': CallSerializer(call).data,
            'token': token,
            'url': settings.LIVEKIT_URL,
        })

    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        call = self.get_object()
        call.ended_at = timezone.now()
        call.save(update_fields=['ended_at'])
        livekit.delete_room(call.room_name)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def show(self, request, pk=None):
        """Урок и задание, открытые у учеников. Сами ученики узнают о смене сразу через
        канал данных LiveKit, а отсюда состояние берут подключившиеся позже"""
        call = self.get_object()
        raw_id = request.data.get('assignment')
        assignment = None
        if raw_id not in (None, ''):
            lessons = _own_lessons(Assignment.objects.all(), request.user, 'created_by')
            assignment = lessons.filter(pk=raw_id).first() if str(raw_id).isdigit() else None
            if assignment is None:
                raise ValidationError({'assignment': ['Урок не найден']})
        task = str(request.data.get('task') or '')
        if task and (assignment is None or task not in _task_keys(assignment)):
            raise ValidationError({'task': ['Такого задания нет в уроке']})
        call.assignment = assignment
        call.shown_task = task
        call.save(update_fields=['assignment', 'shown_task'])
        return Response(CallSerializer(call).data)

    def _call_answers(self, call, user):
        queryset = CallAnswer.objects.select_related('student').prefetch_related('files').filter(
            call=call, assignment=call.assignment_id,
        )
        return queryset if user.is_teacher else queryset.filter(student=user)

    @action(detail=True, methods=['get'])
    def answers(self, request, pk=None):
        call = self.get_object()
        if call.assignment_id is None:
            return Response([])
        data = CallAnswerSerializer(self._call_answers(call, request.user), many=True, context={'request': request}).data
        return Response(data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def answer(self, request, pk=None):
        call = self.get_object()  # чужой созвон → 404
        assignment = call.assignment
        if assignment is None:
            raise ValidationError({'task': ['Учитель не открыл урок в созвоне']})
        task = str(request.data.get('task', ''))
        if task not in _task_keys(assignment):
            raise ValidationError({'task': ['Такого задания нет в уроке']})
        # Браузер отправляет переводы строк формы как \r\n — храним обычные \n
        text = str(request.data.get('text', '')).replace('\r\n', '\n').strip()
        if len(text) > MAX_TASK_ANSWER_TEXT:
            raise ValidationError({'text': [f'Ответ длиннее {MAX_TASK_ANSWER_TEXT} знаков']})
        files = request.FILES.getlist('files')

        raw_ids = _parse_json(request.data.get('delete_file_ids'))
        delete_ids = list(
            CallAnswerFile.objects.filter(
                id__in=[i for i in raw_ids if str(i).isdigit()] if isinstance(raw_ids, list) else [],
                answer__call=call,
                answer__assignment=assignment,
                answer__student=request.user,
                answer__task=task,
            ).values_list('id', flat=True)
        )
        check_uploads(files)
        check_student_quota(request.user, files, deleted_call_ids=delete_ids)

        answer, _ = CallAnswer.objects.select_for_update().get_or_create(
            call=call, assignment=assignment, student=request.user, task=task,
        )
        answer.text = text
        answer.save(update_fields=['text', 'updated_at'])
        CallAnswerFile.objects.filter(id__in=delete_ids).delete()
        for f in files:
            CallAnswerFile.objects.create(answer=answer, name=f.name, file=f)
        mark_active(request.user)

        # Стёр всё — пустой ответ не храним
        if not text and not answer.files.exists():
            answer.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        answer = self._call_answers(call, request.user).get(pk=answer.pk)
        return Response(CallAnswerSerializer(answer, context={'request': request}).data)


class PushView(APIView):
    """Push-уведомления браузера.

    GET /api/push/ — публичный ключ сайта (applicationServerKey для pushManager.subscribe).
    POST /api/push/ {endpoint, keys: {p256dh, auth}} — подписать это устройство.
    DELETE /api/push/ {endpoint} — отписать (при выходе из аккаунта).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({'public_key': push.public_key()})

    def post(self, request):
        endpoint = str(request.data.get('endpoint', '')).strip()
        keys = request.data.get('keys') or {}
        p256dh = str(keys.get('p256dh', '')).strip() if isinstance(keys, dict) else ''
        auth = str(keys.get('auth', '')).strip() if isinstance(keys, dict) else ''
        if not endpoint.startswith('https://') or len(endpoint) > 1000 or not p256dh or not auth \
                or len(p256dh) > 200 or len(auth) > 100:
            return Response({'error': 'Неверная подписка'}, status=status.HTTP_400_BAD_REQUEST)
        # Устройство могло принадлежать другому аккаунту (вышли и вошли другим) — подписка переходит
        PushSubscription.objects.update_or_create(
            endpoint=endpoint, defaults={'account': request.user, 'p256dh': p256dh, 'auth': auth},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def delete(self, request):
        endpoint = str(request.data.get('endpoint', '')).strip()
        PushSubscription.objects.filter(endpoint=endpoint, account=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class UpdatesView(APIView):
    """GET /api/updates/ — номер версии данных. Сменился — пора перезагрузить уроки и ответы"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({'version': DataVersion.current()})
