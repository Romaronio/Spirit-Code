from rest_framework import serializers
from .media import signed_url
from .models import Account, Assignment, LessonFile, Homework, HomeworkFile, StudentHomework, StudentHomeworkFile

MIN_PASSWORD_LENGTH = 8


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
        return instance


class LessonFileSerializer(serializers.ModelSerializer):
    """Сериализатор для LessonFile"""
    url = serializers.SerializerMethodField()

    class Meta:
        model = LessonFile
        fields = ['id', 'name', 'url', 'file', 'assignment']
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
        fields = ['id', 'name', 'url', 'file', 'homework', 'created_at']
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


class HomeworkSerializer(serializers.ModelSerializer):
    """Сериализатор для Homework с вложенными файлами"""
    files = HomeworkFileSerializer(many=True, read_only=True)

    class Meta:
        model = Homework
        fields = ['id', 'assignment', 'description', 'files', 'created_at', 'updated_at']


class HomeworkCreateSerializer(serializers.ModelSerializer):
    """Сериализатор для создания/обновления Homework (без вложенных файлов)"""
    class Meta:
        model = Homework
        fields = ['id', 'assignment', 'description', 'created_at', 'updated_at']


class StudentHomeworkFileSerializer(serializers.ModelSerializer):
    """Сериализатор для файлов сданной работы"""
    url = serializers.SerializerMethodField()

    class Meta:
        model = StudentHomeworkFile
        fields = ['id', 'name', 'url', 'file', 'student_homework', 'created_at']
        extra_kwargs = {
            'file': {'write_only': True}
        }

    def get_url(self, obj):
        return signed_url(self.context.get('request'), obj.file) if obj.file else None


class StudentHomeworkSerializer(serializers.ModelSerializer):
    """Сериализатор для сданной работы ученика"""
    files = StudentHomeworkFileSerializer(many=True, read_only=True)
    student_name = serializers.CharField(source='student.name', read_only=True)

    class Meta:
        model = StudentHomework
        fields = ['id', 'assignment', 'student', 'student_name', 'description', 'files', 'submitted_at']


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

    class Meta:
        model = Assignment
        fields = [
            'id', 'title', 'subject', 'deadline',
            'recording_url', 'description', 'files', 'homework',
            'student_homeworks', 'created_at', 'updated_at'
        ]

    def get_student_homeworks(self, obj):
        """Учитель видит все ответы, ученик — только свой"""
        answers = obj.student_homeworks.all()
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not getattr(user, 'is_teacher', False):
            user_id = getattr(user, 'id', None)
            answers = [sh for sh in answers if sh.student_id == user_id]
        return StudentHomeworkSerializer(answers, many=True, context=self.context).data
