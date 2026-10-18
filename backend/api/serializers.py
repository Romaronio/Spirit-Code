from rest_framework import serializers
from .models import Account, Assignment, LessonFile, Homework, HomeworkFile, StudentHomework, StudentHomeworkFile


class AccountSerializer(serializers.ModelSerializer):
    """Сериализатор для Account"""
    class Meta:
        model = Account
        fields = ['id', 'name', 'password', 'role', 'subjects', 'created_at', 'updated_at']
        extra_kwargs = {
            'password': {'write_only': True}  # пароль не возвращается при GET запросах
        }


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
        if obj.file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None


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
        if obj.file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None


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
        if obj.file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None


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
    homework = HomeworkCreateSerializer(read_only=True, required=False)
    student_homeworks = StudentHomeworkSerializer(many=True, read_only=True)

    class Meta:
        model = Assignment
        fields = [
            'id', 'title', 'subject', 'deadline',
            'recording_url', 'description', 'files', 'homework',
            'student_homeworks', 'created_at', 'updated_at'
        ]