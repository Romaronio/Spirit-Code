from rest_framework import serializers
from .answer_check import task_checks
from .media import signed_url
from .models import MAX_LATEX_LENGTH, MAX_TOTAL_LATEX_LENGTH, Account, AnswerComment, Assignment, Call, CallAnswer, CallAnswerFile, Subject, LessonFile, Homework, HomeworkFile, Payment, StudentHomework, StudentHomeworkFile, TikzFigure, TypingResult
from .tikz import assignment_sources, source_key

MIN_PASSWORD_LENGTH = 5


class AccountSerializer(serializers.ModelSerializer):
    """Сериализатор для Account"""
    class Meta:
        model = Account
        fields = ['id', 'name', 'password', 'role', 'subjects', 'created_at', 'updated_at']
        extra_kwargs = {
            'password': {'write_only': True}  # пароль не возвращается при GET запросах
        }

    def validate_name(self, value):
        """Имена не должны совпадать даже с точностью до регистра —
        иначе при входе в любом регистре непонятно, чей это аккаунт"""
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Введите имя')
        taken = [a for a in Account.find_by_name(value) if a.pk != getattr(self.instance, 'pk', None)]
        if taken:
            raise serializers.ValidationError(
                'Пользователь с таким именем уже существует, придумайте другое имя'
            )
        return value

    def validate_password(self, value):
        if len(value) < MIN_PASSWORD_LENGTH:
            raise serializers.ValidationError(
                f'Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов'
            )
        return value

    def create(self, validated_data):
        password = validated_data.pop('password')
        account = Account(**validated_data)
        account.set_password(password)
        account.save()
        return account

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if password is not None:
            instance.set_password(password)
        instance.save()
        if password is not None:
            instance.tokens.all().delete()  # со старым паролем больше не войти
        return instance


class LessonFileSerializer(serializers.ModelSerializer):
    """Сериализатор для LessonFile"""
    url = serializers.SerializerMethodField()

    class Meta:
        model = LessonFile
        fields = ['id', 'name', 'url', 'file', 'assignment', 'task_number']
        extra_kwargs = {
            'file': {'write_only': True}
        }

    def get_url(self, obj):
        return signed_url(self.context.get('request'), obj.file) if obj.file else None


class HomeworkFileSerializer(serializers.ModelSerializer):
    """Сериализатор для HomeworkFile"""
    url = serializers.SerializerMethodField()

    class Meta:
        model = HomeworkFile
        fields = ['id', 'name', 'url', 'file', 'homework', 'task_number', 'created_at']
        extra_kwargs = {
            'file': {'write_only': True}
        }

    def get_url(self, obj):
        return signed_url(self.context.get('request'), obj.file) if obj.file else None


class HomeworkFileWriteSerializer(serializers.ModelSerializer):
    """Сериализатор для создания файлов ДЗ с загрузкой файла"""
    class Meta:
        model = HomeworkFile
        fields = ['id', 'name', 'file', 'homework']
        extra_kwargs = {
            'file': {'write_only': True}
        }


MAX_TASK_ANSWER_LENGTH = 500


def clean_numbered_tasks(value, allow_required=True):
    """Список {number, latex, answer, short_only}: номера от 1 до 999 без повторов, по возрастанию.
    Ответ необязателен — пустой не сохраняем. short_only — ученик присылает только краткий ответ
    (без программы и файлов); detailed_required — без программы или файла к номеру ученик
    не отправит ДЗ (бывает только у номеров ДЗ: allow_required=False для классной работы).
    Флаги хранятся, только если включены, и вместе не бывают"""
    if value in (None, ''):
        return []
    if not isinstance(value, list) or len(value) > 50:
        raise serializers.ValidationError('Ожидается список заданий по номерам')
    tasks = {}
    for item in value:
        if not isinstance(item, dict):
            raise serializers.ValidationError('Ожидается список заданий по номерам')
        number, latex, answer = item.get('number'), item.get('latex', ''), item.get('answer', '')
        if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= 999:
            raise serializers.ValidationError('Номер задания — целое число от 1 до 999')
        if not isinstance(latex, str):
            raise serializers.ValidationError(f'Задание {number}: LaTeX должен быть текстом')
        if len(latex) > MAX_LATEX_LENGTH:
            raise serializers.ValidationError(f'Задание {number}: LaTeX длиннее {MAX_LATEX_LENGTH} знаков')
        if not isinstance(answer, str) or len(answer.strip()) > MAX_TASK_ANSWER_LENGTH:
            raise serializers.ValidationError(f'Задание {number}: ответ — текст до {MAX_TASK_ANSWER_LENGTH} знаков')
        if number in tasks:
            raise serializers.ValidationError(f'Номер {number} указан дважды')
        tasks[number] = {'number': number, 'latex': latex}
        if answer.strip():
            tasks[number]['answer'] = answer.strip()
        if item.get('short_only') is True:
            tasks[number]['short_only'] = True
        elif allow_required and item.get('detailed_required') is True:
            tasks[number]['detailed_required'] = True
    if sum(len(t['latex']) for t in tasks.values()) > MAX_TOTAL_LATEX_LENGTH:
        raise serializers.ValidationError(f'Все задания вместе длиннее {MAX_TOTAL_LATEX_LENGTH} знаков')
    return [tasks[n] for n in sorted(tasks)]


def clean_subject_list(value):
    """Список названий предметов без пустых и повторов (без учёта регистра)"""
    if value in (None, ''):
        return []
    if not isinstance(value, list) or len(value) > 20 or not all(isinstance(s, str) for s in value):
        raise serializers.ValidationError('Ожидается список предметов')
    result, seen = [], set()
    for name in value:
        name = ' '.join(name.split())
        if len(name) > 100:
            raise serializers.ValidationError('Название предмета — до 100 знаков')
        if name and name.casefold() not in seen:
            seen.add(name.casefold())
            result.append(name)
    return result


def without_answers(tasks):
    """Номера заданий для ученика: ответы к ним видит только учитель"""
    return [{k: v for k, v in t.items() if k != 'answer'} for t in tasks or []]


class HomeworkSerializer(serializers.ModelSerializer):
    """Сериализатор для Homework с вложенными файлами"""
    files = HomeworkFileSerializer(many=True, read_only=True)

    class Meta:
        model = Homework
        fields = ['id', 'assignment', 'description', 'numbered_tasks', 'tasks_latex', 'files', 'created_at', 'updated_at']


class HomeworkCreateSerializer(serializers.ModelSerializer):
    """Сериализатор для создания/обновления Homework (без вложенных файлов)"""
    class Meta:
        model = Homework
        fields = ['id', 'assignment', 'description', 'numbered_tasks', 'tasks_latex', 'created_at', 'updated_at']


class StudentHomeworkFileSerializer(serializers.ModelSerializer):
    """Сериализатор для файлов сданной работы"""
    url = serializers.SerializerMethodField()

    class Meta:
        model = StudentHomeworkFile
        fields = ['id', 'name', 'url', 'file', 'student_homework', 'task_key', 'created_at']
        extra_kwargs = {
            'file': {'write_only': True}
        }

    def get_url(self, obj):
        return signed_url(self.context.get('request'), obj.file) if obj.file else None


class AnswerCommentSerializer(serializers.ModelSerializer):
    """Сообщение в переписке по ответу"""
    author_name = serializers.CharField(source='author.name', read_only=True)
    author_role = serializers.CharField(source='author.role', read_only=True)

    class Meta:
        model = AnswerComment
        fields = ['id', 'author', 'author_name', 'author_role', 'text', 'created_at', 'edited_at']
        read_only_fields = ['author', 'edited_at']

    def validate_text(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Сообщение не может быть пустым')
        return value


class StudentHomeworkSerializer(serializers.ModelSerializer):
    """Сериализатор для сданной работы ученика"""
    files = StudentHomeworkFileSerializer(many=True, read_only=True)
    comments = AnswerCommentSerializer(many=True, read_only=True)
    student_name = serializers.CharField(source='student.name', read_only=True)
    task_checks = serializers.SerializerMethodField()

    class Meta:
        model = StudentHomework
        fields = [
            'id', 'assignment', 'student', 'student_name', 'description', 'task_answers', 'task_checks',
            'files', 'submitted_at', 'status', 'checked_at', 'comments',
        ]
        read_only_fields = ['status', 'checked_at', 'task_answers']

    def get_task_checks(self, obj):
        """Автопроверка кратких ответов: {'hw-5': True, 'hw-6': False}"""
        user = getattr(self.context.get('request'), 'user', None)
        return task_checks(obj, for_teacher=getattr(user, 'is_teacher', False))


class StudentHomeworkCreateSerializer(serializers.ModelSerializer):
    """Сериализатор для создания/обновления сданной работы"""
    class Meta:
        model = StudentHomework
        fields = ['id', 'assignment', 'student', 'description', 'submitted_at']


class AssignmentSerializer(serializers.ModelSerializer):
    """Сериализатор для Assignment с вложенными файлами и домашним заданием"""
    files = LessonFileSerializer(many=True, read_only=True)
    homework = HomeworkSerializer(read_only=True, required=False)
    student_homeworks = serializers.SerializerMethodField()
    figures = serializers.SerializerMethodField()

    class Meta:
        model = Assignment
        fields = [
            'id', 'title', 'subject', 'extra_subjects', 'deadline',
            'recording_url', 'numbered_tasks', 'tasks_latex', 'files', 'homework',
            'student_homeworks', 'figures', 'created_at', 'updated_at'
        ]

    def validate_numbered_tasks(self, value):
        # Классную работу можно не решать — развёрнутый ответ к ней не бывает обязательным
        return clean_numbered_tasks(value, allow_required=False)

    def validate_extra_subjects(self, value):
        return clean_subject_list(value)

    def validate(self, attrs):
        # Основной предмет в дополнительных не повторяем
        subject = attrs.get('subject', getattr(self.instance, 'subject', ''))
        extra = attrs.get('extra_subjects', getattr(self.instance, 'extra_subjects', None) or [])
        if 'extra_subjects' in attrs or 'subject' in attrs:
            attrs['extra_subjects'] = [s for s in extra if s.casefold() != subject.strip().casefold()]
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        user = getattr(self.context.get('request'), 'user', None)
        if not getattr(user, 'is_teacher', False):
            data['numbered_tasks'] = without_answers(data.get('numbered_tasks'))
            if data.get('homework'):
                data['homework']['numbered_tasks'] = without_answers(data['homework'].get('numbered_tasks'))
        return data

    def get_figures(self, obj):
        """Рисунки TikZ заданий; страница находит свой рисунок по его тексту (source).
        Почему рисунок не собрался, видит только учитель"""
        sources = assignment_sources(obj)
        if not sources:
            return []
        request = self.context.get('request')
        is_teacher = getattr(getattr(request, 'user', None), 'is_teacher', False)
        result = []
        for figure in TikzFigure.objects.filter(key__in=[source_key(s) for s in sources]):
            item = {'source': figure.source, 'status': figure.status}
            if figure.status == TikzFigure.READY:
                item['url'] = signed_url(request, figure.svg)
            elif figure.status == TikzFigure.ERROR and is_teacher:
                item['error'] = figure.error
            result.append(item)
        return result

    def get_student_homeworks(self, obj):
        """Учитель видит все ответы, ученик — только свой"""
        answers = obj.student_homeworks.all()
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not getattr(user, 'is_teacher', False):
            user_id = getattr(user, 'id', None)
            answers = [sh for sh in answers if sh.student_id == user_id]
        return StudentHomeworkSerializer(answers, many=True, context=self.context).data


class PaymentSerializer(serializers.ModelSerializer):
    """Отметка оплаты за месяц"""
    class Meta:
        model = Payment
        fields = ['student', 'year', 'month']

    def validate_month(self, value):
        if not 1 <= value <= 12:
            raise serializers.ValidationError('Месяц должен быть от 1 до 12')
        return value

    def validate_student(self, value):
        if value.role != 'student':
            raise serializers.ValidationError('Оплату можно отмечать только ученикам')
        return value


class TypingResultSerializer(serializers.ModelSerializer):
    """Результат теста печати. Скорость и точность вычисляются здесь, а не на клиенте"""
    student_name = serializers.CharField(source='student.name', read_only=True)

    # Быстрее этого люди не печатают — такие результаты считаем подделкой
    MAX_CPM = 1200

    class Meta:
        model = TypingResult
        fields = [
            'id', 'student', 'student_name', 'language', 'duration',
            'correct_words', 'correct_chars', 'keystrokes', 'errors',
            'wpm', 'cpm', 'accuracy', 'created_at',
        ]
        read_only_fields = ['student', 'wpm', 'cpm', 'accuracy', 'created_at']

    def validate_duration(self, value):
        if value not in TypingResult.DURATIONS:
            raise serializers.ValidationError('Недопустимая длительность теста')
        return value

    def validate(self, data):
        minutes = data['duration'] / 60
        if data['errors'] > data['keystrokes']:
            raise serializers.ValidationError('Слов с ошибкой не может быть больше, чем нажатий')
        if data['correct_chars'] > data['keystrokes']:
            raise serializers.ValidationError('Верных знаков не может быть больше, чем нажатий')
        if data['correct_words'] > data['correct_chars']:
            raise serializers.ValidationError('Слов не может быть больше, чем знаков')
        if data['correct_chars'] / minutes > self.MAX_CPM:
            raise serializers.ValidationError('Слишком высокая скорость — результат не сохранён')

        # Строки кода разной длины, поэтому для них «слово» — 5 знаков (стандарт WPM)
        if data.get('language') in TypingResult.PHRASE_LANGUAGES:
            data['wpm'] = round(data['correct_chars'] / 5 / minutes)
        else:
            data['wpm'] = round(data['correct_words'] / minutes)
        data['cpm'] = round(data['correct_chars'] / minutes)
        # Точность — доля верных слов среди всех отправленных пробелом
        total_words = data['correct_words'] + data['errors']
        data['accuracy'] = round(data['correct_words'] / total_words * 100, 1) if total_words else 0
        return data


class SubjectSerializer(serializers.ModelSerializer):
    """Предмет в списках выбора"""
    class Meta:
        model = Subject
        fields = ['id', 'name']

    def validate_name(self, value):
        value = ' '.join(value.split())
        if not value:
            raise serializers.ValidationError('Введите название предмета')
        return value


class CallSerializer(serializers.ModelSerializer):
    """Созвон-урок: кто начал, по какому предмету, идёт ли ещё"""
    started_by_name = serializers.CharField(source='started_by.name', read_only=True)
    student_name = serializers.CharField(source='student.name', read_only=True, default=None)
    student = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.filter(role='student'), required=False, allow_null=True,
    )
    assignment = serializers.PrimaryKeyRelatedField(
        queryset=Assignment.objects.all(), required=False, allow_null=True,
    )
    assignment_title = serializers.CharField(source='assignment.title', read_only=True, default=None)

    class Meta:
        model = Call
        fields = [
            'id', 'title', 'subject', 'extra_subjects', 'student', 'student_name', 'assignment', 'assignment_title',
            'shown_task',
            'started_by_name', 'started_at', 'ended_at',
        ]
        read_only_fields = ['started_at', 'ended_at', 'shown_task']

    def validate_title(self, value):
        return value.strip()

    def validate_subject(self, value):
        return value.strip()

    def validate_extra_subjects(self, value):
        return clean_subject_list(value)

    def validate(self, attrs):
        if attrs.get('student'):
            attrs['subject'] = ''  # личный урок — предмет не нужен
        subject = attrs.get('subject', '')
        # Без основного предмета созвон и так для всех
        attrs['extra_subjects'] = [
            s for s in attrs.get('extra_subjects', []) if subject and s.casefold() != subject.casefold()
        ]
        return attrs


class CallAnswerFileSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = CallAnswerFile
        fields = ['id', 'name', 'url', 'created_at']

    def get_url(self, obj):
        return signed_url(self.context.get('request'), obj.file) if obj.file else None


class CallAnswerSerializer(serializers.ModelSerializer):
    """Ответ ученика на уроке в созвоне — не ДЗ, без статуса проверки"""
    student_name = serializers.CharField(source='student.name', read_only=True)
    files = CallAnswerFileSerializer(many=True, read_only=True)

    class Meta:
        model = CallAnswer
        fields = ['id', 'assignment', 'student', 'student_name', 'task', 'text', 'files', 'updated_at']
