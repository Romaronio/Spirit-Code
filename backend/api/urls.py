from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AccountViewSet, AssignmentViewSet, LessonFileViewSet

router = DefaultRouter()
router.register(r'accounts', AccountViewSet, basename='account')
router.register(r'assignments', AssignmentViewSet, basename='assignment')
router.register(r'lesson-files', LessonFileViewSet, basename='lessonfile')

urlpatterns = [
    path('', include(router.urls)),
]
