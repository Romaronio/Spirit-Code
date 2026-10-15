from rest_framework import serializers
from .models import Account, Assignment, LessonFile, Homework, HomeworkFile


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


class HomeworkSerializer(serializers.ModelSerializer):
    """Сериализатор для Homework с вложенными файлами"""
    files = HomeworkFileSerializer(many=True, read_only=True)

    class Meta:
        model = Homework
        fields = ['id', 'assignment', 'description', 'files', 'created_at', 'updated_at']


class AssignmentSerializer(serializers.ModelSerializer):
    """Сериализатор для Assignment с вложенными файлами и домашним заданием"""
    files = LessonFileSerializer(many=True, read_only=True)
    homework = HomeworkSerializer(read_only=True)

    class Meta:
        model = Assignment
        fields = [
            'id', 'title', 'subject', 'deadline',
            'recording_url', 'description', 'files', 'homework',
            'created_at', 'updated_at'
        ]
