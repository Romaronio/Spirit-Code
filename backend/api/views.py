from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Account, Assignment, LessonFile
from .serializers import AccountSerializer, AssignmentSerializer, LessonFileSerializer


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

    def get_queryset(self):
        """Фильтрация заданий по предмету"""
        queryset = Assignment.objects.all()
        subject = self.request.query_params.get('subject', None)
        if subject:
            queryset = queryset.filter(subject=subject)
        return queryset


class LessonFileViewSet(viewsets.ModelViewSet):
    """API endpoint для работы с файлами уроков"""
    queryset = LessonFile.objects.all()
    serializer_class = LessonFileSerializer
