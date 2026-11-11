from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .parent import ParentView
from .views import AccountViewSet, AssignmentViewSet, LessonFileViewSet, HomeworkViewSet, HomeworkFileViewSet, StudentHomeworkViewSet, SubjectViewSet, PaymentViewSet, AnswerCommentViewSet, TypingResultViewSet, CallViewSet, PhotoLatexView, PushView, UpdatesView

router = DefaultRouter()
router.register(r'accounts', AccountViewSet, basename='account')
router.register(r'assignments', AssignmentViewSet, basename='assignment')
router.register(r'lesson-files', LessonFileViewSet, basename='lessonfile')
router.register(r'homeworks', HomeworkViewSet, basename='homework')
router.register(r'homework-files', HomeworkFileViewSet, basename='homeworkfile')
router.register(r'student-homeworks', StudentHomeworkViewSet, basename='studenthomework')
router.register(r'payments', PaymentViewSet, basename='payment')
router.register(r'subjects', SubjectViewSet, basename='subject')
router.register(r'answer-comments', AnswerCommentViewSet, basename='answercomment')
router.register(r'typing-results', TypingResultViewSet, basename='typingresult')
router.register(r'calls', CallViewSet, basename='call')

urlpatterns = [
    path('photo-latex/', PhotoLatexView.as_view()),
    path('updates/', UpdatesView.as_view()),
    path('push/', PushView.as_view()),
    path('parent/<str:token>/', ParentView.as_view()),
    path('', include(router.urls)),
]
