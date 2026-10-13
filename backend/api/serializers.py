from rest_framework import serializers
from .models import Account, Assignment, LessonFile


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
    class Meta:
        model = LessonFile
        fields = ['id', 'name', 'url']


class AssignmentSerializer(serializers.ModelSerializer):
    """Сериализатор для Assignment с вложенными файлами"""
    files = LessonFileSerializer(many=True, read_only=True)

    class Meta:
        model = Assignment
        fields = [
            'id', 'title', 'subject', 'deadline',
            'recording_url', 'description', 'files',
            'created_at', 'updated_at'
        ]
