from rest_framework.permissions import BasePermission


def _role(request):
    user = request.user
    if not (user and user.is_authenticated):
        return None
    return getattr(user, 'role', None)


class IsTeacher(BasePermission):
    """Доступ только для вошедшего учителя"""
    message = 'Действие доступно только учителю'

    def has_permission(self, request, view):
        return _role(request) == 'teacher'


class IsReviewer(BasePermission):
    """Учитель или куратор: смотреть уроки и ответы учеников, проверять ДЗ"""
    message = 'Действие доступно только учителю или куратору'

    def has_permission(self, request, view):
        return _role(request) in ('teacher', 'curator')


class IsStudent(BasePermission):
    """Доступ только для вошедшего ученика"""
    message = 'Действие доступно только ученику'

    def has_permission(self, request, view):
        return _role(request) == 'student'
