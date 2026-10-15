from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AccountViewSet, AssignmentViewSet, LessonFileViewSet, HomeworkViewSet, HomeworkFileViewSet

router = DefaultRouter()
router.register(r'accounts', AccountViewSet, basename='account')
router.register(r'assignments', AssignmentViewSet, basename='assignment')
router.register(r'lesson-files', LessonFileViewSet, basename='lessonfile')
router.register(r'homeworks', HomeworkViewSet, basename='homework')
router.register(r'homework-files', HomeworkFileViewSet, basename='homeworkfile')

urlpatterns = [
    path('', include(router.urls)),
]
