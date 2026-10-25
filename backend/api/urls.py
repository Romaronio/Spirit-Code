from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AccountViewSet, AssignmentViewSet, LessonFileViewSet, HomeworkViewSet, HomeworkFileViewSet, StudentHomeworkViewSet, PaymentViewSet, AnswerCommentViewSet, TypingResultViewSet

router = DefaultRouter()
router.register(r'accounts', AccountViewSet, basename='account')
router.register(r'assignments', AssignmentViewSet, basename='assignment')
router.register(r'lesson-files', LessonFileViewSet, basename='lessonfile')
router.register(r'homeworks', HomeworkViewSet, basename='homework')
router.register(r'homework-files', HomeworkFileViewSet, basename='homeworkfile')
router.register(r'student-homeworks', StudentHomeworkViewSet, basename='studenthomework')
router.register(r'payments', PaymentViewSet, basename='payment')
router.register(r'answer-comments', AnswerCommentViewSet, basename='answercomment')
router.register(r'typing-results', TypingResultViewSet, basename='typingresult')

urlpatterns = [
    path('', include(router.urls)),
]
