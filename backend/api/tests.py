import base64
import hashlib
import hmac
import json
import os
import shutil
import tempfile
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import urlsplit

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Account, Assignment, AuthToken, Call, DataVersion, Homework, HomeworkFile, PushSubscription, Subject, LessonFile, StudentHomework, StudentHomeworkFile, TikzFigure, TypingResult
from .tikz import MAX_SOURCE_LENGTH, TikzError, _in_points, _run as tikz_run, compile_svg, extract_figures, render_pending


class AuthTestCase(APITestCase):
    def setUp(self):
        cache.clear()  # сбрасываем лимит попыток входа между тестами
        self.teacher = self.make_account('roman', 'teacher')
        self.teacher.is_owner = True  # создатель платформы, как на сервере (миграция 0039)
        self.teacher.save(update_fields=['is_owner'])
        self.anna = self.make_account('anna', 'student', ['Биология'])
        self.ivan = self.make_account('ivan', 'student', ['Английский'])
        self.bio = Assignment.objects.create(title='Фотосинтез', subject='Биология', deadline='2026-11-01')
        self.eng = Assignment.objects.create(title='Present Perfect', subject='Английский', deadline='2026-11-01')

    def make_account(self, name, role, subjects=None):
        account = Account(name=name, role=role, subjects=subjects or [])
        account.set_password(f'{name}-password')
        account.save()
        return account

    def login_as(self, account):
        response = self.client.post(
            '/api/accounts/login/',
            {'name': account.name, 'password': f'{account.name}-password'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {response.data['token']}")
        return response


class LoginTests(AuthTestCase):
    def test_password_is_hashed(self):
        self.teacher.refresh_from_db()
        self.assertNotIn('roman-password', self.teacher.password)
        self.assertTrue(self.teacher.check_password('roman-password'))

    def test_login_returns_token_without_password(self):
        response = self.login_as(self.teacher)
        self.assertIn('token', response.data)
        self.assertNotIn('password', response.data['account'])

    def test_wrong_password(self):
        response = self.client.post('/api/accounts/login/', {'name': 'roman', 'password': 'nope'}, format='json')
        self.assertEqual(response.status_code, 401)

    def test_login_is_throttled(self):
        for _ in range(10):
            self.client.post('/api/accounts/login/', {'name': 'roman', 'password': 'nope'}, format='json')
        response = self.client.post('/api/accounts/login/', {'name': 'roman', 'password': 'nope'}, format='json')
        self.assertEqual(response.status_code, 429)

    def test_logout_revokes_token(self):
        self.login_as(self.teacher)
        self.assertEqual(self.client.post('/api/accounts/logout/').status_code, 204)
        self.assertEqual(self.client.get('/api/assignments/').status_code, 401)

    @override_settings(AUTH_TOKEN_TTL_DAYS=1)
    def test_expired_token(self):
        self.login_as(self.teacher)
        AuthToken.objects.update(created_at=AuthToken.objects.get().created_at - timedelta(days=2))
        self.assertEqual(self.client.get('/api/assignments/').status_code, 401)

    def test_bad_token(self):
        self.client.credentials(HTTP_AUTHORIZATION='Token fake')
        self.assertEqual(self.client.get('/api/assignments/').status_code, 401)


class PermissionTests(AuthTestCase):
    def test_anonymous_is_rejected(self):
        for url in ['/api/accounts/', '/api/assignments/', '/api/student-homeworks/', '/api/accounts/me/']:
            self.assertEqual(self.client.get(url).status_code, 401, url)

    def test_student_cannot_manage_accounts(self):
        self.login_as(self.anna)
        self.assertEqual(self.client.get('/api/accounts/').status_code, 403)
        response = self.client.post(
            '/api/accounts/',
            {'name': 'hacker', 'password': '12345678', 'role': 'teacher'},
            format='json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.delete(f'/api/accounts/{self.ivan.id}/').status_code, 403)

    def test_student_me(self):
        self.login_as(self.anna)
        response = self.client.get('/api/accounts/me/')
        self.assertEqual(response.data['name'], 'anna')
        self.assertEqual(response.data['subjects'], ['Биология'])

    def test_student_sees_only_own_subjects(self):
        self.login_as(self.anna)
        titles = [a['title'] for a in self.client.get('/api/assignments/').data['results']]
        self.assertEqual(titles, ['Фотосинтез'])
        self.assertEqual(self.client.get(f'/api/assignments/{self.eng.id}/').status_code, 404)

    def test_student_cannot_edit_assignments(self):
        self.login_as(self.anna)
        self.assertEqual(self.client.patch(f'/api/assignments/{self.bio.id}/', {'title': 'x'}).status_code, 403)
        self.assertEqual(self.client.delete(f'/api/assignments/{self.bio.id}/').status_code, 403)

    def test_teacher_creates_student_with_hashed_password(self):
        self.login_as(self.teacher)
        response = self.client.post(
            '/api/accounts/',
            {'name': 'petya', 'password': 'petya-pass', 'role': 'student', 'subjects': []},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(Account.objects.get(name='petya').check_password('petya-pass'))

    def test_short_password_rejected(self):
        self.login_as(self.teacher)
        response = self.client.post(
            '/api/accounts/', {'name': 'petya', 'password': '123', 'role': 'student'}, format='json'
        )
        self.assertEqual(response.status_code, 400)

    def test_teacher_cannot_delete_self(self):
        self.login_as(self.teacher)
        self.assertEqual(self.client.delete(f'/api/accounts/{self.teacher.id}/').status_code, 400)


class CuratorTests(AuthTestCase):
    """Куратор проверяет ДЗ, но не создаёт и не меняет уроки и не управляет учениками"""
    def setUp(self):
        super().setUp()
        self.curator = self.make_account('olga', 'curator')
        self.curator.students.set([self.anna])  # за куратором закреплена только Анна
        self.bio.numbered_tasks = [{'number': 5, 'latex': 'x', 'answer': '42'}]
        self.bio.save()
        self.sh = StudentHomework.objects.create(
            assignment=self.bio, student=self.anna, description='ответ', task_answers={'cw-5': '42'},
        )

    def test_curator_sees_lessons_answers_and_correct_answers_of_own_students(self):
        self.login_as(self.curator)
        # Только уроки по предметам Анны; урок Ивана (английский) куратору не виден
        ids = {a['id'] for a in self.client.get('/api/assignments/').data['results']}
        self.assertEqual(ids, {self.bio.id})
        data = self.client.get(f'/api/assignments/{self.bio.id}/').data
        self.assertEqual(data['numbered_tasks'][0]['answer'], '42')
        self.assertEqual([sh['id'] for sh in data['student_homeworks']], [self.sh.id])
        self.assertEqual(data['student_homeworks'][0]['task_checks'], {'cw-5': True})
        # Список учеников — только он сам и закреплённые ученики
        names = {a['name'] for a in self.client.get('/api/accounts/').data['results']}             if isinstance(self.client.get('/api/accounts/').data, dict) else {a['name'] for a in self.client.get('/api/accounts/').data}
        self.assertEqual(names, {'olga', 'anna'})
        self.assertEqual(self.client.get('/api/subjects/').status_code, 200)

    def test_curator_does_not_see_other_students(self):
        ivan_answer = StudentHomework.objects.create(assignment=self.bio, student=self.ivan, description='чужой')
        self.login_as(self.curator)
        data = self.client.get(f'/api/assignments/{self.bio.id}/').data
        self.assertEqual([sh['student'] for sh in data['student_homeworks']], [self.anna.id])
        url = f'/api/student-homeworks/{ivan_answer.id}/'
        self.assertEqual(self.client.post(url + 'review/', {'status': 'accepted'}, format='json').status_code, 404)
        self.assertEqual(self.client.post(url + 'comments/', {'text': 'x'}, format='json').status_code, 404)
        self.assertEqual(self.client.get(f'/api/typing-results/by-mode/?student={self.ivan.id}').status_code, 404)
        # Ученик ответил на урок не своего предмета — куратор этот урок тоже видит
        StudentHomework.objects.create(assignment=self.eng, student=self.anna, description='x')
        ids = {a['id'] for a in self.client.get('/api/assignments/').data['results']}
        self.assertEqual(ids, {self.bio.id, self.eng.id})
        # Без закреплённых учеников куратор не видит ничего
        self.curator.students.clear()
        self.assertEqual(self.client.get('/api/assignments/').data['results'], [])

    def test_owner_assigns_students_to_curator(self):
        self.login_as(self.teacher)
        url = f'/api/accounts/{self.curator.id}/'
        response = self.client.patch(url, {'students': [self.anna.id, self.ivan.id]}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sorted(response.data['students']), sorted([self.anna.id, self.ivan.id]))
        # Учителя за куратором не закрепить, ученику учеников тоже
        self.assertEqual(self.client.patch(url, {'students': [self.teacher.id]}, format='json').status_code, 400)
        response = self.client.patch(f'/api/accounts/{self.anna.id}/', {'students': [self.ivan.id]}, format='json')
        self.assertEqual(response.status_code, 400)
        # Обычный учитель закреплять не может — кураторами управляет создатель
        petr = self.make_account('petr', 'teacher')
        self.login_as(petr)
        self.assertEqual(self.client.patch(url, {'students': []}, format='json').status_code, 403)

    def test_curator_reviews_and_comments(self):
        self.login_as(self.curator)
        url = f'/api/student-homeworks/{self.sh.id}/'
        response = self.client.post(url + 'review/', {'status': 'accepted'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.sh.refresh_from_db()
        self.assertEqual(self.sh.status, 'accepted')
        response = self.client.post(url + 'comments/', {'text': 'Молодец'}, format='json')
        self.assertEqual(response.status_code, 201)

    def test_curator_cannot_edit_lessons_or_accounts(self):
        self.login_as(self.curator)
        self.assertEqual(self.client.post('/api/assignments/', {'title': 'x', 'subject': 'Биология'}).status_code, 403)
        self.assertEqual(self.client.patch(f'/api/assignments/{self.bio.id}/', {'title': 'x'}).status_code, 403)
        self.assertEqual(self.client.delete(f'/api/assignments/{self.bio.id}/').status_code, 403)
        self.assertEqual(self.client.post('/api/subjects/', {'name': 'x'}, format='json').status_code, 403)
        response = self.client.post('/api/accounts/', {'name': 'x', 'password': '12345678', 'role': 'student'}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.patch(f'/api/accounts/{self.anna.id}/', {'subjects': []}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/accounts/{self.anna.id}/').status_code, 403)
        self.assertEqual(self.client.post(f'/api/accounts/{self.anna.id}/reset_password/').status_code, 403)
        self.assertEqual(self.client.get('/api/payments/').status_code, 403)
        self.assertEqual(self.client.post('/api/calls/', {'title': 'x'}, format='json').status_code, 403)
        # Сдавать ответы куратор тоже не может
        self.assertEqual(self.client.post(f'/api/assignments/{self.bio.id}/submit/', {'description': 'x'}).status_code, 403)

    def test_teacher_creates_curator(self):
        self.login_as(self.teacher)
        response = self.client.post(
            '/api/accounts/', {'name': 'Мария', 'password': '12345678', 'role': 'curator'}, format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['role'], 'curator')


class OwnerTests(AuthTestCase):
    """Учителей и кураторов добавляет и меняет только создатель, учеников — любой учитель"""
    def setUp(self):
        super().setUp()
        self.petr = self.make_account('petr', 'teacher')
        self.curator = self.make_account('olga', 'curator')

    def create(self, name, role):
        return self.client.post('/api/accounts/', {'name': name, 'password': '12345678', 'role': role}, format='json')

    def test_owner_flag_in_api_and_read_only(self):
        self.login_as(self.teacher)
        self.assertTrue(self.client.get('/api/accounts/me/').data['is_owner'])
        response = self.client.patch(f'/api/accounts/{self.petr.id}/', {'is_owner': True}, format='json')
        self.assertEqual(response.status_code, 200)
        self.petr.refresh_from_db()
        self.assertFalse(self.petr.is_owner)

    def test_owner_manages_teachers_and_curators(self):
        self.login_as(self.teacher)
        self.assertEqual(self.create('Новый учитель', 'teacher').status_code, 201)
        self.assertEqual(self.create('Новый куратор', 'curator').status_code, 201)
        self.assertEqual(self.client.post(f'/api/accounts/{self.curator.id}/reset_password/').status_code, 200)
        self.assertEqual(self.client.post(f'/api/accounts/{self.petr.id}/reset_password/').status_code, 200)
        self.assertEqual(self.client.delete(f'/api/accounts/{self.curator.id}/').status_code, 204)
        self.assertEqual(self.client.delete(f'/api/accounts/{self.petr.id}/').status_code, 204)

    def test_other_teacher_manages_only_students(self):
        self.login_as(self.petr)
        self.assertEqual(self.create('Новый ученик', 'student').status_code, 201)
        self.assertEqual(self.client.post(f'/api/accounts/{self.anna.id}/reset_password/').status_code, 200)
        self.assertEqual(self.client.delete(f'/api/accounts/{self.ivan.id}/').status_code, 204)
        self.assertEqual(self.create('Учитель 2', 'teacher').status_code, 403)
        self.assertEqual(self.create('Куратор 2', 'curator').status_code, 403)
        self.assertEqual(self.client.post(f'/api/accounts/{self.curator.id}/reset_password/').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/accounts/{self.curator.id}/').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/accounts/{self.teacher.id}/').status_code, 403)
        # Ученика в учителя не превратить
        response = self.client.patch(f'/api/accounts/{self.anna.id}/', {'role': 'teacher'}, format='json')
        self.assertEqual(response.status_code, 403)
        self.anna.refresh_from_db()
        self.assertEqual(self.anna.role, 'student')

    def test_owner_cannot_be_demoted(self):
        self.login_as(self.teacher)
        response = self.client.patch(f'/api/accounts/{self.teacher.id}/', {'role': 'student'}, format='json')
        self.assertEqual(response.status_code, 403)


class SubmitTests(AuthTestCase):
    def test_submit_is_always_from_current_student(self):
        self.login_as(self.anna)
        response = self.client.post(
            f'/api/assignments/{self.bio.id}/submit/',
            {'student_id': self.ivan.id, 'description': 'готово',
             'files': SimpleUploadedFile('answer.txt', b'42')},
        )
        self.assertEqual(response.status_code, 201)
        sh = StudentHomework.objects.get()
        self.assertEqual(sh.student, self.anna)
        sh.files.get().file.delete()

    def test_empty_submit_creates_nothing(self):
        self.login_as(self.anna)
        response = self.client.post(f'/api/assignments/{self.bio.id}/submit/', {'description': '   '})
        self.assertEqual(response.status_code, 204)
        self.assertFalse(StudentHomework.objects.exists())

    def test_student_cannot_submit_to_foreign_subject(self):
        self.login_as(self.anna)
        response = self.client.post(f'/api/assignments/{self.eng.id}/submit/', {'description': 'x'})
        self.assertEqual(response.status_code, 404)

    def test_teacher_cannot_submit(self):
        self.login_as(self.teacher)
        response = self.client.post(f'/api/assignments/{self.bio.id}/submit/', {'description': 'x'})
        self.assertEqual(response.status_code, 403)


class SubjectTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        Subject.objects.all().delete()  # миграция заполняет стандартными — начинаем с пустого списка

    def test_add_list_delete(self):
        self.login_as(self.teacher)
        response = self.client.post('/api/subjects/', {'name': '  Физика  '}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['name'], 'Физика')
        # Тот же предмет в другом регистре — не дубль
        again = self.client.post('/api/subjects/', {'name': 'физика'}, format='json')
        self.assertEqual(again.data['id'], response.data['id'])
        self.assertEqual([s['name'] for s in self.client.get('/api/subjects/').data], ['Физика'])
        self.assertEqual(self.client.delete(f"/api/subjects/{response.data['id']}/").status_code, 204)
        self.assertEqual(self.client.get('/api/subjects/').data, [])
        self.assertEqual(self.client.post('/api/subjects/', {'name': '  '}, format='json').status_code, 400)

    def test_new_lesson_adds_subject(self):
        self.login_as(self.teacher)
        self.client.post('/api/assignments/', {'title': 'Законы Ньютона', 'subject': 'Физика'})
        # Урок нового курса попадает и в «Информатику»
        self.assertEqual(list(Subject.objects.values_list('name', flat=True)), ['Информатика', 'Физика'])

    def test_moving_lesson_adds_subject(self):
        self.login_as(self.teacher)
        response = self.client.patch(f'/api/assignments/{self.bio.id}/', {'subject': 'ЕГЭ информатика'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['subject'], 'ЕГЭ информатика')
        self.assertEqual(list(Subject.objects.values_list('name', flat=True)), ['ЕГЭ информатика', 'Информатика'])

    def test_lesson_in_several_subjects(self):
        self.login_as(self.teacher)
        response = self.client.patch(
            f'/api/assignments/{self.bio.id}/',
            {'extra_subjects': json.dumps(['ЕГЭ биология', 'биология', ' ЕГЭ  биология '])},
        )
        self.assertEqual(response.status_code, 200)
        # Основной предмет и повторы отброшены
        self.assertEqual(response.data['extra_subjects'], ['ЕГЭ биология', 'Информатика'])
        self.assertIn('ЕГЭ биология', Subject.objects.values_list('name', flat=True))
        # Ученик только с дополнительным предметом урок видит, с другим — нет
        self.ivan.subjects = ['егэ биология']
        self.ivan.save()
        self.login_as(self.ivan)
        self.assertEqual(self.client.get(f'/api/assignments/{self.bio.id}/').status_code, 200)
        self.ivan.subjects = ['Английский']
        self.ivan.save()
        self.assertEqual(self.client.get(f'/api/assignments/{self.bio.id}/').status_code, 404)

    def test_main_subject_not_duplicated(self):
        self.bio.extra_subjects = ['ЕГЭ биология']
        self.bio.save()
        self.login_as(self.teacher)
        response = self.client.patch(f'/api/assignments/{self.bio.id}/', {'subject': 'ЕГЭ биология'})
        self.assertEqual(response.data['extra_subjects'], [])

    def test_lesson_goes_to_informatics(self):
        self.login_as(self.teacher)
        created = self.client.post('/api/assignments/', {'title': 'Циклы', 'subject': 'ЕГЭ по информатике 2026/2027'})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['extra_subjects'], ['Информатика'])
        # Уроки Математики и Русского языка в «Информатику» не попадают
        for subject in ('Математика', 'русский язык'):
            response = self.client.post('/api/assignments/', {'title': 'Урок', 'subject': subject})
            self.assertEqual(response.data['extra_subjects'], [])
        # Урок «Информатики» второй раз её не получает
        response = self.client.post('/api/assignments/', {'title': 'Урок', 'subject': 'информатика'})
        self.assertEqual(response.data['extra_subjects'], [])
        # Учитель убрал урок из «Информатики» — при следующих сохранениях она не возвращается
        url = f"/api/assignments/{created.data['id']}/"
        response = self.client.patch(url, {'extra_subjects': json.dumps([])})
        self.assertEqual(response.data['extra_subjects'], [])
        response = self.client.patch(url, {'title': 'Циклы 2', 'subject': 'ЕГЭ по информатике 2026/2027'})
        self.assertEqual(response.data['extra_subjects'], [])
        # Добавили в ещё один курс — урок снова попадает в «Информатику»
        response = self.client.patch(url, {'extra_subjects': json.dumps(['Спецкурс'])})
        self.assertEqual(response.data['extra_subjects'], ['Спецкурс', 'Информатика'])

    def test_delete_keeps_lessons_and_students(self):
        subject = Subject.objects.create(name='Биология')
        self.login_as(self.teacher)
        self.client.delete(f'/api/subjects/{subject.id}/')
        self.assertTrue(Assignment.objects.filter(subject='Биология').exists())
        self.anna.refresh_from_db()
        self.assertEqual(self.anna.subjects, ['Биология'])

    def test_only_teacher(self):
        self.login_as(self.anna)
        self.assertEqual(self.client.get('/api/subjects/').status_code, 403)
        self.assertEqual(self.client.post('/api/subjects/', {'name': 'x'}, format='json').status_code, 403)


class TaskAnswerTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.bio.numbered_tasks = [{'number': 5, 'latex': 'x', 'answer': '42'}]
        self.bio.save()
        self.url = f'/api/assignments/{self.bio.id}/submit-task/'

    def test_answer_to_task_with_file(self):
        self.login_as(self.anna)
        response = self.client.post(self.url, {
            'task': 'cw-5', 'text': ' 42 ', 'files': SimpleUploadedFile('code.py', b'print(42)'),
        })
        self.assertEqual(response.status_code, 201)
        sh = StudentHomework.objects.get()
        self.assertEqual(sh.task_answers, {'cw-5': '42'})
        f = sh.files.get()
        self.assertEqual(f.task_key, 'cw-5')
        # Общий ответ не трогает ответы к заданиям и их файлы
        self.client.post(f'/api/assignments/{self.bio.id}/submit/', {
            'description': 'всё', 'delete_file_ids': json.dumps([f.id]),
        })
        sh.refresh_from_db()
        self.assertEqual(sh.task_answers, {'cw-5': '42'})
        self.assertTrue(sh.files.filter(id=f.id).exists())
        # Пустой текст и удалённый файл — ответа к заданию больше нет
        self.client.post(self.url, {'task': 'cw-5', 'text': '', 'delete_file_ids': json.dumps([f.id])})
        sh.refresh_from_db()
        self.assertEqual(sh.task_answers, {})
        self.assertFalse(sh.files.exists())

    def test_cleared_answer_is_removed(self):
        self.login_as(self.anna)
        self.client.post(self.url, {'task': 'cw-5', 'text': '4'})
        self.assertEqual(StudentHomework.objects.count(), 1)
        # Стёр всё — учителю не висит пустой ответ «на проверке»
        self.assertEqual(self.client.post(self.url, {'task': 'cw-5', 'text': ''}).status_code, 204)
        self.assertFalse(StudentHomework.objects.exists())

    def test_resubmit_resets_status(self):
        Homework.objects.create(assignment=self.bio, numbered_tasks=[{'number': 3, 'latex': 'y'}])
        sh = StudentHomework.objects.create(assignment=self.bio, student=self.anna, status='accepted')
        self.login_as(self.anna)
        # Классную работу учитель не проверяет — её правка отметку не снимает
        self.assertEqual(self.client.post(self.url, {'task': 'cw-5', 'text': '41'}).status_code, 200)
        sh.refresh_from_db()
        self.assertEqual(sh.status, 'accepted')
        # Ответ к ДЗ изменился — снова на проверку
        self.assertEqual(self.client.post(self.url, {'task': 'hw-3', 'text': '7'}).status_code, 200)
        sh.refresh_from_db()
        self.assertEqual(sh.status, 'pending')

    def test_unknown_task_rejected(self):
        self.login_as(self.anna)
        self.assertEqual(self.client.post(self.url, {'task': 'cw-6', 'text': '1'}).status_code, 400)
        self.assertEqual(self.client.post(self.url, {'task': 'homework', 'text': '1'}).status_code, 400)
        self.assertFalse(StudentHomework.objects.exists())

    def test_foreign_subject_and_teacher(self):
        self.login_as(self.ivan)
        self.assertEqual(self.client.post(self.url, {'task': 'cw-5', 'text': '1'}).status_code, 404)
        self.login_as(self.teacher)
        self.assertEqual(self.client.post(self.url, {'task': 'cw-5', 'text': '1'}).status_code, 403)

    def test_students_see_only_own_answers(self):
        self.ivan.subjects = ['Биология']
        self.ivan.save()
        StudentHomework.objects.create(assignment=self.bio, student=self.ivan, description='ответ Ивана')
        StudentHomework.objects.create(assignment=self.bio, student=self.anna, description='ответ Анны')

        self.login_as(self.anna)
        answers = self.client.get(f'/api/assignments/{self.bio.id}/').data['student_homeworks']
        self.assertEqual([a['description'] for a in answers], ['ответ Анны'])

        self.client.credentials()
        self.login_as(self.teacher)
        answers = self.client.get(f'/api/assignments/{self.bio.id}/').data['student_homeworks']
        self.assertEqual(len(answers), 2)


class MediaTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.lesson_file = LessonFile.objects.create(
            assignment=self.bio, name='урок.txt', file=SimpleUploadedFile('урок.txt', b'secret')
        )

    def tearDown(self):
        self.lesson_file.file.delete()

    def file_url(self):
        self.login_as(self.anna)
        url = self.client.get(f'/api/assignments/{self.bio.id}/').data['files'][0]['url']
        self.client.credentials()  # файл качаем без токена, как браузер по ссылке
        return urlsplit(url)

    def test_signed_link_works(self):
        parts = self.file_url()
        response = self.client.get(f'{parts.path}?{parts.query}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), b'secret')

    def test_unsigned_link_is_forbidden(self):
        parts = self.file_url()
        self.assertEqual(self.client.get(parts.path).status_code, 403)

    def test_signature_is_bound_to_file(self):
        parts = self.file_url()
        other = parts.path.replace('lesson_files/', 'student_homework_files/')
        self.assertEqual(self.client.get(f'{other}?{parts.query}').status_code, 403)

    @override_settings(MEDIA_URL_TTL_SECONDS=-1)
    def test_expired_link_is_forbidden(self):
        parts = self.file_url()
        self.assertEqual(self.client.get(f'{parts.path}?{parts.query}').status_code, 403)

    def test_caddy_forward_auth(self):
        parts = self.file_url()
        ok = self.client.get('/api/media-auth/', HTTP_X_FORWARDED_URI=f'{parts.path}?{parts.query}')
        self.assertEqual(ok.status_code, 204)
        bad = self.client.get('/api/media-auth/', HTTP_X_FORWARDED_URI=parts.path)
        self.assertEqual(bad.status_code, 403)


class UploadLimitTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.mkdtemp()
        self.media = override_settings(MEDIA_ROOT=self.tmp)
        self.media.enable()

    def tearDown(self):
        self.media.disable()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def submit(self, *files, **data):
        return self.client.post(
            f'/api/assignments/{self.bio.id}/submit/',
            {'description': 'ответ', 'files': list(files), **data},
        )

    def test_too_big_file_rejected(self):
        self.login_as(self.anna)
        response = self.submit(SimpleUploadedFile('big.pdf', b'x' * (10 * 1024 * 1024 + 1)))
        self.assertEqual(response.status_code, 400)
        self.assertIn('больше 10 МБ', response.data['files'][0])
        self.assertFalse(StudentHomework.objects.exists())

    def test_forbidden_type_rejected(self):
        self.login_as(self.anna)
        response = self.submit(SimpleUploadedFile('virus.exe', b'MZ'))
        self.assertEqual(response.status_code, 400)

    def test_teacher_upload_limits(self):
        self.login_as(self.teacher)
        response = self.client.patch(
            f'/api/assignments/{self.bio.id}/',
            {'files': [SimpleUploadedFile('script.exe', b'MZ')]},
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(LessonFile.objects.exists())

    @override_settings(STUDENT_STORAGE_QUOTA=10)
    def test_student_quota(self):
        self.login_as(self.anna)
        self.assertEqual(self.submit(SimpleUploadedFile('a.txt', b'12345678')).status_code, 201)
        self.assertEqual(self.submit(SimpleUploadedFile('b.txt', b'12345')).status_code, 400)
        # если убрать старый файл, место освобождается
        old_id = StudentHomeworkFile.objects.get().id
        response = self.submit(SimpleUploadedFile('b.txt', b'12345'), delete_file_ids=json.dumps([old_id]))
        self.assertEqual(response.status_code, 200)

    def test_deleted_files_removed_from_disk(self):
        self.login_as(self.anna)
        self.submit(SimpleUploadedFile('a.txt', b'1'))
        path = StudentHomeworkFile.objects.get().file.path
        self.assertTrue(os.path.exists(path))
        with self.captureOnCommitCallbacks(execute=True):
            self.submit(delete_file_ids=json.dumps([StudentHomeworkFile.objects.get().id]))
        self.assertFalse(os.path.exists(path))

    def test_cascade_delete_removes_files(self):
        self.login_as(self.anna)
        self.submit(SimpleUploadedFile('a.txt', b'1'))
        path = StudentHomeworkFile.objects.get().file.path
        with self.captureOnCommitCallbacks(execute=True):
            self.bio.delete()
        self.assertFalse(os.path.exists(path))


class CaseInsensitiveLoginTests(AuthTestCase):
    def test_login_any_case(self):
        for name in ['ROMAN', 'Roman', '  roman  ']:
            response = self.client.post(
                '/api/accounts/login/', {'name': name, 'password': 'roman-password'}, format='json'
            )
            self.assertEqual(response.status_code, 200, name)
            self.assertEqual(response.data['account']['name'], 'roman')

    def test_cyrillic_name_any_case(self):
        self.make_account('Иван', 'student')
        response = self.client.post(
            '/api/accounts/login/', {'name': 'иВАН', 'password': 'Иван-password'}, format='json'
        )
        self.assertEqual(response.status_code, 200)

    def test_wrong_password_still_rejected(self):
        response = self.client.post(
            '/api/accounts/login/', {'name': 'ROMAN', 'password': 'wrong'}, format='json'
        )
        self.assertEqual(response.status_code, 401)

    def test_cannot_create_name_differing_only_in_case(self):
        self.login_as(self.teacher)
        response = self.client.post(
            '/api/accounts/', {'name': 'ANNA', 'password': '12345678', 'role': 'student'}, format='json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('уже существует', response.data['name'][0])

    def test_rename_to_own_name_in_other_case_is_ok(self):
        self.login_as(self.teacher)
        response = self.client.patch(f'/api/accounts/{self.anna.id}/', {'name': 'Anna'}, format='json')
        self.assertEqual(response.status_code, 200)


class UniqueCredentialsTests(AuthTestCase):
    def create(self, name, password):
        return self.client.post(
            '/api/accounts/', {'name': name, 'password': password, 'role': 'student'}, format='json'
        )

    def test_same_password_is_allowed(self):
        self.login_as(self.teacher)
        self.assertEqual(self.create('petya', 'anna-password').status_code, 201)

    def test_same_name_rejected(self):
        self.login_as(self.teacher)
        response = self.create('Anna', 'unique-pass-1')
        self.assertEqual(response.status_code, 400)
        self.assertIn('придумайте другое имя', response.data['name'][0])

    def test_unique_name_and_password_ok(self):
        self.login_as(self.teacher)
        self.assertEqual(self.create('petya', 'unique-pass-1').status_code, 201)

    def test_keeping_own_password_on_update_is_ok(self):
        self.login_as(self.teacher)
        response = self.client.patch(
            f'/api/accounts/{self.anna.id}/', {'password': 'anna-password'}, format='json'
        )
        self.assertEqual(response.status_code, 200)


class ReviewTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.answer = StudentHomework.objects.create(assignment=self.bio, student=self.anna, description='ответ')

    def review(self, value):
        return self.client.post(f'/api/student-homeworks/{self.answer.id}/review/', {'status': value}, format='json')

    def test_teacher_marks_answer(self):
        self.login_as(self.teacher)
        response = self.review('accepted')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'accepted')
        self.assertIsNotNone(response.data['checked_at'])

        response = self.review('pending')
        self.assertEqual(response.data['status'], 'pending')
        self.assertIsNone(response.data['checked_at'])

    def test_unknown_status_rejected(self):
        self.login_as(self.teacher)
        self.assertEqual(self.review('excellent').status_code, 400)

    def test_student_cannot_review(self):
        self.login_as(self.anna)
        self.assertEqual(self.review('accepted').status_code, 403)

    def test_student_sees_status(self):
        self.answer.status = 'rejected'
        self.answer.save()
        self.login_as(self.anna)
        answers = self.client.get(f'/api/assignments/{self.bio.id}/').data['student_homeworks']
        self.assertEqual(answers[0]['status'], 'rejected')

    def test_resubmit_resets_status(self):
        self.answer.status = 'rejected'
        self.answer.save()
        self.login_as(self.anna)
        response = self.client.post(f'/api/assignments/{self.bio.id}/submit/', {'description': 'исправила'})
        self.assertEqual(response.data['status'], 'pending')


class PaymentTests(AuthTestCase):
    def set_paid(self, student, year, month, paid=True):
        return self.client.post(
            '/api/payments/set/',
            {'student': student.id, 'year': year, 'month': month, 'paid': paid},
            format='json',
        )

    def test_mark_and_unmark(self):
        self.login_as(self.teacher)
        self.assertTrue(self.set_paid(self.anna, 2026, 10).data['paid'])
        self.assertTrue(self.set_paid(self.anna, 2026, 10).data['paid'])  # повтор — не ошибка
        self.assertFalse(self.set_paid(self.anna, 2026, 10, paid=False).data['paid'])

    def test_list_by_school_year(self):
        self.login_as(self.teacher)
        self.set_paid(self.anna, 2026, 9)   # входит в 2026/27
        self.set_paid(self.anna, 2027, 8)   # входит в 2026/27
        self.set_paid(self.anna, 2026, 8)   # прошлый учебный год
        self.set_paid(self.anna, 2027, 9)   # следующий учебный год
        data = self.client.get('/api/payments/?school_year=2026').data
        self.assertEqual([(p['year'], p['month']) for p in data], [(2026, 9), (2027, 8)])

    def test_bad_month_and_teacher_target(self):
        self.login_as(self.teacher)
        self.assertEqual(self.set_paid(self.anna, 2026, 13).status_code, 400)
        self.assertEqual(self.set_paid(self.teacher, 2026, 10).status_code, 400)

    def test_student_has_no_access(self):
        self.login_as(self.anna)
        self.assertEqual(self.client.get('/api/payments/?school_year=2026').status_code, 403)
        self.assertEqual(self.set_paid(self.anna, 2026, 10).status_code, 403)


class ResetPasswordTests(AuthTestCase):
    def test_teacher_resets_student_password(self):
        # у ученицы есть активная сессия
        student_client = self.client_class()
        token = self.client.post(
            '/api/accounts/login/', {'name': 'anna', 'password': 'anna-password'}, format='json'
        ).data['token']
        student_client.credentials(HTTP_AUTHORIZATION=f'Token {token}')

        self.login_as(self.teacher)
        response = self.client.post(f'/api/accounts/{self.anna.id}/reset_password/')
        self.assertEqual(response.status_code, 200)
        new_password = response.data['password']
        self.assertEqual(len(new_password), 10)

        self.anna.refresh_from_db()
        self.assertTrue(self.anna.check_password(new_password))
        self.assertFalse(self.anna.check_password('anna-password'))
        # старая сессия больше не работает
        self.assertEqual(student_client.get('/api/accounts/me/').status_code, 401)

    def test_cannot_reset_teacher(self):
        self.login_as(self.teacher)
        self.assertEqual(self.client.post(f'/api/accounts/{self.teacher.id}/reset_password/').status_code, 400)

    def test_student_cannot_reset(self):
        self.login_as(self.anna)
        self.assertEqual(self.client.post(f'/api/accounts/{self.ivan.id}/reset_password/').status_code, 403)


class CommentTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.ivan.subjects = ['Биология']
        self.ivan.save()
        self.answer = StudentHomework.objects.create(assignment=self.bio, student=self.anna, description='ответ')

    def comment(self, text, answer=None):
        answer = answer or self.answer
        return self.client.post(f'/api/student-homeworks/{answer.id}/comments/', {'text': text}, format='json')

    def test_teacher_and_student_talk(self):
        self.login_as(self.teacher)
        response = self.comment('  Перепроверь задачу 3  ')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['text'], 'Перепроверь задачу 3')
        self.assertEqual(response.data['author_role'], 'teacher')

        self.client.credentials()
        self.login_as(self.anna)
        self.assertEqual(self.comment('Исправила').status_code, 201)

        answers = self.client.get(f'/api/assignments/{self.bio.id}/').data['student_homeworks']
        self.assertEqual([c['text'] for c in answers[0]['comments']], ['Перепроверь задачу 3', 'Исправила'])

    def test_student_cannot_comment_foreign_answer(self):
        self.login_as(self.ivan)
        self.assertEqual(self.comment('чужое').status_code, 404)

    def test_empty_comment_rejected(self):
        self.login_as(self.teacher)
        self.assertEqual(self.comment('   ').status_code, 400)

    def test_anonymous_rejected(self):
        self.assertEqual(self.comment('привет').status_code, 401)

    def test_student_still_cannot_review_or_list(self):
        self.login_as(self.anna)
        self.assertEqual(self.client.get('/api/student-homeworks/').status_code, 403)


class CommentEditDeleteTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        from .models import AnswerComment
        self.ivan.subjects = ['Биология']
        self.ivan.save()
        answer = StudentHomework.objects.create(assignment=self.bio, student=self.anna, description='ответ')
        self.teacher_msg = AnswerComment.objects.create(student_homework=answer, author=self.teacher, text='учитель')
        self.anna_msg = AnswerComment.objects.create(student_homework=answer, author=self.anna, text='анна')

    def url(self, comment):
        return f'/api/answer-comments/{comment.id}/'

    def test_author_edits_own_message(self):
        self.login_as(self.anna)
        response = self.client.patch(self.url(self.anna_msg), {'text': 'исправила'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['text'], 'исправила')
        self.assertIsNotNone(response.data['edited_at'])

    def test_cannot_edit_foreign_message(self):
        self.login_as(self.anna)
        self.assertEqual(self.client.patch(self.url(self.teacher_msg), {'text': 'x'}, format='json').status_code, 403)
        self.client.credentials()
        self.login_as(self.teacher)
        self.assertEqual(self.client.patch(self.url(self.anna_msg), {'text': 'x'}, format='json').status_code, 403)

    def test_student_deletes_own_but_not_teachers(self):
        self.login_as(self.anna)
        self.assertEqual(self.client.delete(self.url(self.teacher_msg)).status_code, 403)
        self.assertEqual(self.client.delete(self.url(self.anna_msg)).status_code, 204)

    def test_teacher_deletes_any(self):
        self.login_as(self.teacher)
        self.assertEqual(self.client.delete(self.url(self.anna_msg)).status_code, 204)

    def test_other_student_does_not_see_thread(self):
        self.login_as(self.ivan)
        self.assertEqual(self.client.delete(self.url(self.anna_msg)).status_code, 404)
        self.assertEqual(self.client.patch(self.url(self.anna_msg), {'text': 'x'}, format='json').status_code, 404)


class TypingResultTests(AuthTestCase):
    def send(self, **changes):
        # 60 секунд: 40 верных слов (240 знаков) и 10 слов с ошибкой, 250 нажатий
        data = {'language': 'ru', 'duration': 60, 'correct_words': 40,
                'correct_chars': 240, 'keystrokes': 250, 'errors': 10, **changes}
        return self.client.post('/api/typing-results/', data, format='json')

    def test_server_computes_speed(self):
        self.login_as(self.anna)
        response = self.send(duration=30, wpm=999)  # присланную скорость игнорируем
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['wpm'], 80)
        self.assertEqual(response.data['cpm'], 480)
        self.assertEqual(response.data['accuracy'], 80.0)  # 40 верных из 50 слов
        self.assertEqual(response.data['student'], self.anna.id)

    def test_ege_mode(self):
        self.login_as(self.anna)
        self.assertEqual(self.send(language='ege').data['language'], 'ege')
        self.assertEqual(self.send(language='xx').status_code, 400)

    def test_ege_hard_counts_five_chars_as_word(self):
        self.login_as(self.anna)
        response = self.send(language='ege_hard', correct_words=12)  # 12 строк, 240 знаков за минуту
        self.assertEqual(response.data['wpm'], 48)
        self.assertEqual(response.data['cpm'], 240)

    def test_rejects_impossible_results(self):
        self.login_as(self.anna)
        self.assertEqual(self.send(duration=45).status_code, 400)
        self.assertEqual(self.send(errors=300).status_code, 400)
        self.assertEqual(self.send(correct_chars=300).status_code, 400)
        self.assertEqual(self.send(correct_chars=1500, keystrokes=1500).status_code, 400)
        self.assertFalse(TypingResult.objects.exists())

    def test_student_sees_only_own_results(self):
        self.login_as(self.ivan)
        self.send()
        self.login_as(self.anna)
        self.send()
        results = self.client.get('/api/typing-results/').data['results']
        self.assertEqual([r['student'] for r in results], [self.anna.id])
        self.assertEqual(self.client.get('/api/typing-results/summary/').status_code, 403)
        self.assertEqual(self.client.get(f'/api/typing-results/by-mode/?student={self.anna.id}').status_code, 403)

    def test_teacher_summary_and_filter(self):
        self.login_as(self.anna)
        self.send(correct_words=30)
        self.send(correct_words=50)
        self.login_as(self.teacher)
        self.assertEqual(self.send().status_code, 403)  # учитель тренируется без сохранения

        rows = {r['student_name']: r for r in self.client.get('/api/typing-results/summary/').data}
        self.assertEqual(rows['anna']['tests'], 2)
        self.assertEqual(rows['anna']['best_wpm'], 50)
        self.assertEqual(rows['anna']['last_wpm'], 50)
        self.assertEqual(rows['anna']['avg_wpm'], 40)
        self.assertEqual(rows['ivan']['tests'], 0)
        self.assertIsNone(rows['ivan']['best_wpm'])

        modes = {m['language']: m for m in self.client.get(f'/api/typing-results/by-mode/?student={self.anna.id}').data}
        self.assertEqual(list(modes), ['ru', 'en', 'ege', 'ege_hard'])
        self.assertEqual(modes['ru']['tests'], 2)
        self.assertEqual(modes['ru']['best_wpm'], 50)
        self.assertEqual(modes['ege_hard']['tests'], 0)
        self.assertIsNone(modes['ege_hard']['best_wpm'])
        self.assertEqual(self.client.get('/api/typing-results/by-mode/').status_code, 400)

        results = self.client.get(f'/api/typing-results/?student={self.ivan.id}').data['results']
        self.assertEqual(results, [])
        results = self.client.get(f'/api/typing-results/?student={self.anna.id}').data['results']
        self.assertEqual(len(results), 2)


class LessonEditTests(AuthTestCase):
    def patch(self, data):
        return self.client.patch(f'/api/assignments/{self.bio.id}/', data, format='multipart')

    def test_teacher_renames_lesson(self):
        self.login_as(self.teacher)
        response = self.patch({'title': 'Дыхание растений'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['title'], 'Дыхание растений')

    def test_title_cannot_be_blank(self):
        self.login_as(self.teacher)
        self.assertEqual(self.patch({'title': '   '}).status_code, 400)
        self.bio.refresh_from_db()
        self.assertEqual(self.bio.title, 'Фотосинтез')

    def test_teacher_changes_and_clears_recording_url(self):
        self.login_as(self.teacher)
        url = 'https://vkvideo.ru/video-1_2'
        self.assertEqual(self.patch({'recording_url': url}).data['recording_url'], url)
        self.assertEqual(self.patch({'recording_url': 'https://vkvideo.ru/video-3_4'}).status_code, 200)
        self.assertEqual(self.patch({'recording_url': ''}).data['recording_url'], '')

    def test_rename_keeps_other_fields(self):
        self.login_as(self.teacher)
        self.patch({'recording_url': 'https://vkvideo.ru/video-1_2', 'tasks_latex': 'x'})
        response = self.patch({'title': 'Новое'})
        self.assertEqual(response.data['recording_url'], 'https://vkvideo.ru/video-1_2')
        self.assertEqual(response.data['tasks_latex'], 'x')

    def test_lesson_description_not_in_api(self):
        self.bio.description = 'старое описание'
        self.bio.save()
        self.login_as(self.teacher)
        self.assertNotIn('description', self.client.get(f'/api/assignments/{self.bio.id}/').data)
        self.patch({'description': 'новое'})
        self.bio.refresh_from_db()
        self.assertEqual(self.bio.description, 'старое описание')


class TasksLatexTests(AuthTestCase):
    LATEX = r'\zadacha{1} Найдите $x$, если $x^2 = 4$.'

    def patch(self, data):
        return self.client.patch(f'/api/assignments/{self.bio.id}/', data, format='multipart')

    def test_teacher_saves_classwork_and_homework_latex(self):
        self.login_as(self.teacher)
        response = self.patch({
            'tasks_latex': self.LATEX,
            'homework': json.dumps({'tasks_latex': r'\zadacha{1} ДЗ'}),
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['tasks_latex'], self.LATEX)
        self.assertEqual(response.data['homework']['tasks_latex'], r'\zadacha{1} ДЗ')

        self.login_as(self.anna)
        data = self.client.get(f'/api/assignments/{self.bio.id}/').data
        self.assertEqual(data['tasks_latex'], self.LATEX)
        self.assertEqual(data['homework']['tasks_latex'], r'\zadacha{1} ДЗ')

    def test_homework_created_from_latex_alone(self):
        self.login_as(self.teacher)
        response = self.patch({'homework': json.dumps({'tasks_latex': self.LATEX})})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['homework']['tasks_latex'], self.LATEX)

    def test_homework_numbered_tasks(self):
        self.login_as(self.teacher)
        tasks = [{'number': 7, 'latex': 'семь'}, {'number': 3, 'latex': ''}]
        response = self.patch({'homework': json.dumps({'numbered_tasks': tasks})})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['homework']['numbered_tasks'], [
            {'number': 3, 'latex': ''}, {'number': 7, 'latex': 'семь'},
        ])

        bad = [{'number': 3, 'latex': ''}, {'number': 3, 'latex': ''}]
        response = self.patch({'homework': json.dumps({'numbered_tasks': bad})})
        self.assertEqual(response.status_code, 400)

    def test_homework_description_not_in_api(self):
        self.login_as(self.teacher)
        self.patch({'homework': json.dumps({'tasks_latex': self.LATEX})})
        Homework.objects.filter(assignment=self.bio).update(description='старое описание')
        # Описание не приходит и не меняется, остальное ДЗ не трогается
        response = self.patch({'homework': json.dumps({'description': 'новое'})})
        self.assertNotIn('description', response.data['homework'])
        self.assertEqual(response.data['homework']['tasks_latex'], self.LATEX)
        self.assertEqual(Homework.objects.get(assignment=self.bio).description, 'старое описание')

    def test_too_long_latex_rejected(self):
        self.login_as(self.teacher)
        too_long = 'x' * 200_001
        self.assertEqual(self.patch({'tasks_latex': too_long}).status_code, 400)
        response = self.patch({'homework': json.dumps({'tasks_latex': too_long})})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Assignment.objects.get(pk=self.bio.pk).tasks_latex)

    def test_student_cannot_edit_latex(self):
        self.login_as(self.anna)
        self.assertEqual(self.patch({'tasks_latex': self.LATEX}).status_code, 403)

    def test_numbered_tasks(self):
        self.login_as(self.teacher)
        tasks = [{'number': 7, 'latex': r'\zadacha{1} B'}, {'number': 2, 'latex': self.LATEX}, {'number': 1}]
        response = self.patch({'numbered_tasks': json.dumps(tasks)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['numbered_tasks'], [
            {'number': 1, 'latex': ''},
            {'number': 2, 'latex': self.LATEX},
            {'number': 7, 'latex': r'\zadacha{1} B'},
        ])

        self.login_as(self.anna)
        data = self.client.get(f'/api/assignments/{self.bio.id}/').data
        self.assertEqual(data['numbered_tasks'][1]['latex'], self.LATEX)

        self.login_as(self.teacher)
        for bad in ([{'number': 0}], [{'number': 2}, {'number': 2}], '5', [5], [{'number': 3, 'latex': 1}],
                    [{'number': 3, 'latex': 'x' * 200_001}]):
            self.assertEqual(self.patch({'numbered_tasks': json.dumps(bad)}).status_code, 400, bad)
        response = self.patch({'numbered_tasks': json.dumps([])})
        self.assertEqual(response.data['numbered_tasks'], [])

    def test_task_answer_visible_only_to_teacher(self):
        self.login_as(self.teacher)
        tasks = [{'number': 5, 'latex': 'x', 'answer': ' 42 '}, {'number': 6, 'latex': 'y', 'answer': ''}]
        response = self.patch({
            'numbered_tasks': json.dumps(tasks),
            'homework': json.dumps({'numbered_tasks': [{'number': 1, 'latex': 'z', 'answer': '7'}]}),
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['numbered_tasks'], [
            {'number': 5, 'latex': 'x', 'answer': '42'}, {'number': 6, 'latex': 'y'},
        ])
        self.assertEqual(response.data['homework']['numbered_tasks'][0]['answer'], '7')

        self.login_as(self.anna)
        data = self.client.get(f'/api/assignments/{self.bio.id}/').data
        self.assertEqual(data['numbered_tasks'], [{'number': 5, 'latex': 'x'}, {'number': 6, 'latex': 'y'}])
        self.assertEqual(data['homework']['numbered_tasks'], [{'number': 1, 'latex': 'z'}])
        listed = self.client.get('/api/assignments/').data['results']
        self.assertNotIn('answer', json.dumps(listed))

        self.login_as(self.teacher)
        bad = [{'number': 5, 'answer': 'x' * 501}]
        self.assertEqual(self.patch({'numbered_tasks': json.dumps(bad)}).status_code, 400)

    def test_detailed_required_task(self):
        """Без программы или файла к обязательному номеру ДЗ ученик не отправит урок.
        Классную работу можно не решать — у её номеров флаг не сохраняется"""
        self.login_as(self.teacher)
        tasks = [{'number': 1, 'latex': 'x', 'detailed_required': True},
                 {'number': 2, 'latex': '', 'detailed_required': True},  # пустой номер ученик не видит
                 {'number': 3, 'latex': 'z', 'short_only': True, 'detailed_required': True}]
        response = self.patch({'numbered_tasks': json.dumps(tasks), 'homework': json.dumps({'numbered_tasks': tasks})})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['numbered_tasks'][0], {'number': 1, 'latex': 'x'})  # класс — без флага
        homework = response.data['homework']['numbered_tasks']
        self.assertEqual(homework[0], {'number': 1, 'latex': 'x', 'detailed_required': True})
        self.assertEqual(homework[2], {'number': 3, 'latex': 'z', 'short_only': True})

        self.login_as(self.anna)
        submit = f'/api/assignments/{self.bio.id}/submit/'
        task = f'/api/assignments/{self.bio.id}/submit-task/'
        response = self.client.post(submit, {'description': 'готово'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('1 (дз)', str(response.data))
        self.assertNotIn('2 (дз)', str(response.data))
        self.assertNotIn('класс', str(response.data))

        # Только краткий ответ — не развёрнутый
        self.client.post(task, {'task': 'hw-1', 'text': '42'})
        self.assertEqual(self.client.post(submit, {'description': 'готово'}).status_code, 400)

        # Программа (переводы строк как у браузера) — можно отправлять, классная работа не решена
        self.client.post(task, {'task': 'hw-1', 'text': '42\r\n```\r\nprint(42)\r\n```'})
        self.assertIn(self.client.post(submit, {'description': 'готово'}).status_code, (200, 201))

    def test_short_only_task(self):
        """Учитель отмечает номер «только краткий ответ» — ученик тоже видит отметку"""
        self.login_as(self.teacher)
        tasks = [{'number': 1, 'latex': 'x', 'short_only': True}, {'number': 2, 'latex': 'y', 'short_only': False},
                 {'number': 3, 'latex': 'z', 'short_only': 'yes'}]
        response = self.patch({'numbered_tasks': json.dumps(tasks)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['numbered_tasks'], [
            {'number': 1, 'latex': 'x', 'short_only': True}, {'number': 2, 'latex': 'y'}, {'number': 3, 'latex': 'z'},
        ])

        self.login_as(self.anna)
        data = self.client.get(f'/api/assignments/{self.bio.id}/').data
        self.assertEqual(data['numbered_tasks'][0], {'number': 1, 'latex': 'x', 'short_only': True})


    def test_answers_match(self):
        """Сравнение краткого ответа с верным: не важны пробелы, регистр, запятая в дроби, 7 и 7.0"""
        from .answer_check import answers_match, short_answer
        for student, correct in [('42', '42'), (' 42 ', '42'), ('7.0', '7'), ('2,5', '2.5'), ('Ёлка', 'елка'),
                                 ('12 34', '12 34'), ('12,34', '12 34'), ('12; 34', '12 34'), ('12  34', '12, 34'),
                                 ('yes', 'ДА|YES'), ('-3', '−3')]:
            self.assertTrue(answers_match(student, correct), (student, correct))
        for student, correct in [('41', '42'), ('', '42'), ('34 12', '12 34'), ('12', '12 34'), ('42', '')]:
            self.assertFalse(answers_match(student, correct), (student, correct))
        self.assertEqual(short_answer('42\r\n```\r\nprint(42)\r\n```'), '42')

    def test_auto_check(self):
        """Учитель сразу видит ✓/✗ по номерам с верным ответом; ученик — после «Отправить ответ»
        и только пока не изменил ответ"""
        self.login_as(self.teacher)
        tasks = [{'number': 1, 'latex': 'x', 'answer': '42'}, {'number': 2, 'latex': 'y', 'answer': '7'},
                 {'number': 3, 'latex': 'z'}]
        self.assertEqual(self.patch({'numbered_tasks': json.dumps(tasks)}).status_code, 200)

        self.login_as(self.anna)
        url = f'/api/assignments/{self.bio.id}/'
        task = url + 'submit-task/'
        mine = lambda: self.client.get(url).data['student_homeworks'][0]  # noqa: E731
        self.client.post(task, {'task': 'cw-1', 'text': '42\n```\nprint(42)\n```'})
        self.client.post(task, {'task': 'cw-2', 'text': '8'})
        self.client.post(task, {'task': 'cw-3', 'text': 'что-то'})
        self.assertEqual(mine()['task_checks'], {})  # ещё не отправил

        self.assertIn(self.client.post(url + 'submit/', {'description': ''}).status_code, (200, 201))
        self.assertEqual(mine()['task_checks'], {'cw-1': True, 'cw-2': False})
        self.assertNotIn('42', json.dumps(self.client.get(url).data['numbered_tasks']))  # верный ответ не утёк

        # Исправил ответ — результата по номеру нет, пока не отправит снова
        self.client.post(task, {'task': 'cw-2', 'text': '7'})
        self.assertEqual(mine()['task_checks'], {'cw-1': True})
        self.client.post(url + 'submit/', {'description': ''})
        self.assertEqual(mine()['task_checks'], {'cw-1': True, 'cw-2': True})

        # Учитель видит текущие ответы и номер без ответа ученика — как неверный
        self.client.post(task, {'task': 'cw-2', 'text': ''})
        self.login_as(self.teacher)
        sh = self.client.get(url).data['student_homeworks'][0]
        self.assertEqual(sh['task_checks'], {'cw-1': True, 'cw-2': False})
        # Учитель исправил верный ответ — проверка пересчитывается
        tasks[0]['answer'] = '43'
        self.patch({'numbered_tasks': json.dumps(tasks)})
        self.assertFalse(self.client.get(url).data['student_homeworks'][0]['task_checks']['cw-1'])

class TaskFilesTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.mkdtemp()
        self.media = override_settings(MEDIA_ROOT=self.tmp)
        self.media.enable()
        self.login_as(self.teacher)

    def tearDown(self):
        self.media.disable()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def patch(self, data):
        return self.client.patch(f'/api/assignments/{self.bio.id}/', data, format='multipart')

    def test_files_attached_to_numbers(self):
        response = self.patch({
            'numbered_tasks': json.dumps([{'number': 24, 'latex': 'x'}]),
            'task_files_24': SimpleUploadedFile('24.txt', b'abc'),
            'files': SimpleUploadedFile('общий.txt', b'1'),
            'homework': json.dumps({'numbered_tasks': [{'number': 9, 'latex': 'y'}]}),
            'homework_task_files_9': SimpleUploadedFile('9.csv', b'1;2'),
        })
        self.assertEqual(response.status_code, 200)
        numbers = {f['name']: f['task_number'] for f in response.data['files']}
        self.assertEqual(numbers, {'24.txt': 24, 'общий.txt': None})
        self.assertEqual(response.data['homework']['files'][0]['task_number'], 9)

        # Убрали номер — его файлы удаляются, общий файл остаётся
        response = self.patch({'numbered_tasks': json.dumps([])})
        self.assertEqual([f['name'] for f in response.data['files']], ['общий.txt'])

    def test_delete_selected_files(self):
        self.patch({
            'numbered_tasks': json.dumps([{'number': 1, 'latex': 'x'}]),
            'task_files_1': [SimpleUploadedFile('a.txt', b'a'), SimpleUploadedFile('b.txt', b'b')],
        })
        a = LessonFile.objects.get(name='a.txt')
        other = Assignment.objects.create(title='Чужое', subject='Биология', deadline='2026-12-01')
        foreign = LessonFile.objects.create(assignment=other, name='чужой.txt', file=SimpleUploadedFile('c.txt', b'c'))

        response = self.patch({'delete_file_ids': json.dumps([a.id, foreign.id])})
        self.assertEqual([f['name'] for f in response.data['files']], ['b.txt'])
        self.assertTrue(LessonFile.objects.filter(pk=foreign.pk).exists())

    def test_task_file_type_checked(self):
        response = self.patch({
            'numbered_tasks': json.dumps([{'number': 1, 'latex': 'x'}]),
            'task_files_1': SimpleUploadedFile('virus.exe', b'MZ'),
        })
        self.assertEqual(response.status_code, 400)
        self.assertFalse(LessonFile.objects.exists())


def png_bytes():
    from io import BytesIO
    from PIL import Image
    out = BytesIO()
    Image.new('RGB', (40, 20), 'white').save(out, format='PNG')
    return out.getvalue()


OCR_TEXT = 'Черепахе был дан алгоритм:\nПовтори 5 [Вперёд 33 Направо 135 Вперёд 33 Направо 45]\nНайдите площадь фигуры.'


@override_settings(GIGACHAT_AUTH_KEY='test-key')
class PhotoLatexTests(AuthTestCase):
    """Tesseract и GigaChat подменены — проверяем свою логику, без сети"""

    def setUp(self):
        super().setUp()
        from unittest import mock
        from . import photo_latex
        ocr = mock.patch.object(photo_latex.subprocess, 'run',
                                return_value=mock.Mock(stdout=OCR_TEXT.encode()))
        self.ocr = ocr.start()
        self.addCleanup(ocr.stop)
        complete = mock.patch.object(photo_latex.gigachat, 'complete')
        self.complete = complete.start()
        self.addCleanup(complete.stop)

    def upload(self, name='task.png', **data):
        image = SimpleUploadedFile(name, png_bytes(), content_type='image/png')
        return self.client.post('/api/photo-latex/', {'image': image, **data}, format='multipart')

    def test_only_teacher(self):
        self.login_as(self.anna)
        self.assertEqual(self.upload().status_code, 403)
        self.complete.assert_not_called()

    def test_returns_latex_without_warnings(self):
        self.complete.return_value = (
            '```latex\n\\zadacha{3}\n\\textbf{Повтори 5 [Вперёд 33 Направо 135 Вперёд 33 Направо 45]}\n```'
        )
        self.login_as(self.teacher)
        response = self.upload(number='3')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['latex'].startswith('\\zadacha{3}'))
        self.assertNotIn('```', response.data['latex'])
        self.assertEqual(response.data['warnings'], [])
        self.assertEqual(response.data['ocr_text'], OCR_TEXT)
        prompt = self.complete.call_args.args[0]
        self.assertIn('\\zadacha{3}', prompt)
        self.assertIn(OCR_TEXT, prompt)

    def test_warns_when_numbers_changed(self):
        self.complete.return_value = '\\zadacha{1}\nПовтори 5 [Вперёд 33 Налево 13 Вперёд 33 Направо 45]'
        self.login_as(self.teacher)
        response = self.upload()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['warnings']), 1)
        self.assertIn('пропали 135', response.data['warnings'][0])
        self.assertIn('появились 13', response.data['warnings'][0])

    def test_adds_zadacha_if_model_forgot(self):
        self.complete.return_value = 'Повтори 5 [Вперёд 33 Направо 135 Вперёд 33 Направо 45]'
        self.login_as(self.teacher)
        self.assertTrue(self.upload(number='2').data['latex'].startswith('\\zadacha{2}'))

    def test_rejects_non_image(self):
        self.login_as(self.teacher)
        response = self.upload(name='task.pdf')
        self.assertEqual(response.status_code, 400)
        self.ocr.assert_not_called()

    def test_broken_image(self):
        self.login_as(self.teacher)
        image = SimpleUploadedFile('task.png', b'not an image', content_type='image/png')
        response = self.client.post('/api/photo-latex/', {'image': image}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertIn('картинку', response.data['error'])

    def test_no_text_on_photo(self):
        self.ocr.return_value.stdout = b'  \n '
        self.login_as(self.teacher)
        response = self.upload()
        self.assertEqual(response.status_code, 400)
        self.complete.assert_not_called()

    def test_dollar_from_ocr_becomes_s(self):
        self.ocr.return_value.stdout = 'Запись Повтори К[Команда1 ...Команда$] — из $ команд'.encode()
        self.complete.return_value = '\\zadacha{1}\nтекст'
        self.login_as(self.teacher)
        self.upload()
        prompt = self.complete.call_args.args[0]
        self.assertIn('Команда1 ...КомандаS] — из S команд', prompt)

    def test_unwraps_russian_words_from_math(self):
        from .photo_latex import unwrap_text_math
        self.assertEqual(
            unwrap_text_math('Повтори $k$[$Команда1$ Команда2$ \\ldots КомандаS$] из $S$'),
            'Повтори $k$[Команда1 Команда2 ... КомандаS] из $S$',
        )
        # Настоящие формулы остаются формулами, даже с русскими индексами
        for formula in ('$x^2 = 16$', '$V_{ср}$', '$a < b$'):
            self.assertEqual(unwrap_text_math(formula), formula)

    def test_warns_about_unclosed_formula(self):
        self.complete.return_value = '\\zadacha{1}\nПовтори 5 [Вперёд 33 Направо 135 Вперёд 33 Направо 45] $n'
        self.login_as(self.teacher)
        warnings = self.upload().data['warnings']
        self.assertEqual(len(warnings), 1)
        self.assertIn('незакрытая формула', warnings[0])

    @override_settings(GIGACHAT_AUTH_KEY='')
    def test_disabled_without_key(self):
        self.login_as(self.teacher)
        response = self.upload()
        self.assertEqual(response.status_code, 400)
        self.assertIn('ключа GigaChat', response.data['error'])


class UpdatesTests(AuthTestCase):
    def test_version_grows_on_answer(self):
        self.login_as(self.anna)
        self.assertEqual(self.client.get('/api/updates/').status_code, 200)
        before = self.client.get('/api/updates/').data['version']
        self.bio.numbered_tasks = [{'number': 1, 'latex': 'x'}]
        self.bio.save()
        after_lesson = self.client.get('/api/updates/').data['version']
        self.assertGreater(after_lesson, before)
        self.client.post(f'/api/assignments/{self.bio.id}/submit-task/', {'task': 'cw-1', 'text': '5'}, format='json')
        self.assertGreater(self.client.get('/api/updates/').data['version'], after_lesson)

    def test_needs_login(self):
        self.assertEqual(self.client.get('/api/updates/').status_code, 401)


@override_settings(LIVEKIT_API_KEY='testkey', LIVEKIT_API_SECRET='testsecret', LIVEKIT_URL='', LIVEKIT_API_HOST='', CALLS_STUDENTS=['*'])
class CallTests(AuthTestCase):
    def start_call(self, subject='Биология'):
        self.login_as(self.teacher)
        response = self.client.post('/api/calls/', {'subject': subject, 'title': ' Урок '}, format='json')
        self.assertEqual(response.status_code, 201)
        return response.data['id']

    def test_teacher_starts_and_ends(self):
        call_id = self.start_call()
        self.assertEqual(self.client.get('/api/calls/').data[0]['title'], 'Урок')
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/end/').status_code, 204)
        self.assertEqual(self.client.get('/api/calls/').data, [])
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/join/').status_code, 404)

    def test_students_see_calls_by_subject(self):
        call_id = self.start_call('биология')
        common_id = self.start_call('')
        self.login_as(self.anna)
        self.assertEqual({c['id'] for c in self.client.get('/api/calls/').data}, {call_id, common_id})
        self.login_as(self.ivan)
        self.assertEqual([c['id'] for c in self.client.get('/api/calls/').data], [common_id])
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/join/').status_code, 404)

    def test_call_for_several_subjects(self):
        self.login_as(self.teacher)
        response = self.client.post('/api/calls/', {
            'subject': 'Биология', 'extra_subjects': ['биология', ' Английский '], 'assignment': self.bio.id,
        }, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['extra_subjects'], ['Английский'])
        call_id = response.data['id']
        other = self.make_account('olga', 'student', ['Химия'])
        for student in (self.anna, self.ivan):
            self.login_as(student)
            self.assertEqual([c['id'] for c in self.client.get('/api/calls/').data], [call_id])
            self.assertEqual(self.client.post(f'/api/calls/{call_id}/join/').status_code, 200)
        self.login_as(other)
        self.assertEqual(self.client.get('/api/calls/').data, [])
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/join/').status_code, 404)

    def test_call_lesson_opens_for_student_of_other_subject(self):
        self.login_as(self.teacher)
        call_id = self.client.post('/api/calls/', {
            'subject': 'Биология', 'extra_subjects': ['Английский'], 'assignment': self.bio.id,
        }, format='json').data['id']
        self.login_as(self.ivan)
        self.assertEqual(self.client.get(f'/api/assignments/{self.bio.id}/').status_code, 200)
        self.assertNotIn(self.bio.id, [a['id'] for a in self.client.get('/api/assignments/').data['results']])
        self.login_as(self.teacher)
        self.client.post(f'/api/calls/{call_id}/end/')
        self.login_as(self.ivan)
        self.assertEqual(self.client.get(f'/api/assignments/{self.bio.id}/').status_code, 404)

    def test_student_cannot_start_or_end(self):
        call_id = self.start_call()
        self.login_as(self.anna)
        self.assertEqual(self.client.post('/api/calls/', {'subject': ''}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/end/').status_code, 403)

    def test_join_token(self):
        call_id = self.start_call()
        self.login_as(self.anna)
        response = self.client.post(f'/api/calls/{call_id}/join/')
        self.assertEqual(response.status_code, 200)
        header, payload, signature = response.data['token'].split('.')
        expected = hmac.new(b'testsecret', f'{header}.{payload}'.encode(), hashlib.sha256).digest()
        self.assertEqual(base64.urlsafe_b64decode(signature + '=' * (-len(signature) % 4)), expected)
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        self.assertEqual(claims['iss'], 'testkey')
        self.assertEqual(claims['sub'], f'account-{self.anna.id}')
        self.assertEqual(claims['name'], 'anna')
        self.assertEqual(claims['video']['room'], f'spirit-call-{call_id}')
        self.assertFalse(claims['video']['roomAdmin'])

    def test_lesson_and_shown_task(self):
        self.bio.numbered_tasks = [{'number': 3, 'latex': 'x'}]
        self.bio.save()
        self.login_as(self.teacher)
        call_id = self.client.post('/api/calls/', {'subject': 'Биология', 'assignment': self.bio.id}, format='json').data['id']
        url = f'/api/calls/{call_id}/show/'
        response = self.client.post(url, {'assignment': self.bio.id, 'task': 'cw-3'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['shown_task'], 'cw-3')
        self.assertEqual(response.data['assignment_title'], 'Фотосинтез')
        self.assertEqual(self.client.post(url, {'assignment': self.bio.id, 'task': 'cw-4'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'assignment': 999, 'task': ''}, format='json').status_code, 400)
        # Подключившийся позже ученик сразу получает показанное задание
        self.login_as(self.anna)
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/join/').data['call']['shown_task'], 'cw-3')
        self.assertEqual(self.client.post(url, {'assignment': self.bio.id, 'task': ''}, format='json').status_code, 403)
        # Урок удалили — созвон остаётся, просто без урока
        self.bio.delete()
        self.assertIsNone(Call.objects.get(id=call_id).assignment)

    def test_join_token_marks_teacher(self):
        call_id = self.start_call()
        payload = self.client.post(f'/api/calls/{call_id}/join/').data['token'].split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        self.assertEqual(claims['metadata'], 'teacher')

    def test_call_answers_are_not_homework(self):
        self.bio.numbered_tasks = [{'number': 3, 'latex': 'x'}]
        self.bio.save()
        self.login_as(self.teacher)
        call_id = self.client.post('/api/calls/', {'subject': 'Биология', 'assignment': self.bio.id}, format='json').data['id']
        url = f'/api/calls/{call_id}/answer/'
        self.assertEqual(self.client.post(url, {'task': 'cw-3', 'text': 'x'}, format='json').status_code, 403)

        self.login_as(self.anna)
        response = self.client.post(url, {'task': 'cw-3', 'text': ' 42 '}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['text'], '42')
        self.assertEqual(self.client.post(url, {'task': 'cw-9', 'text': '1'}, format='json').status_code, 400)
        # В ДЗ ответ на уроке не попал — проверять нечего
        self.assertFalse(StudentHomework.objects.filter(student=self.anna).exists())
        self.assertEqual([a['text'] for a in self.client.get(f'/api/calls/{call_id}/answers/').data], ['42'])

        self.login_as(self.teacher)
        answers = self.client.get(f'/api/calls/{call_id}/answers/').data
        self.assertEqual([(a['student_name'], a['task'], a['text']) for a in answers], [('anna', 'cw-3', '42')])

        # Стёр ответ — он удалён
        self.login_as(self.anna)
        self.assertEqual(self.client.post(url, {'task': 'cw-3', 'text': ''}, format='json').status_code, 204)
        self.assertEqual(self.client.get(f'/api/calls/{call_id}/answers/').data, [])

    def test_call_answer_needs_lesson_and_access(self):
        call_id = self.start_call()
        self.login_as(self.anna)
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/answer/', {'task': 'cw-1', 'text': '1'}, format='json').status_code, 400)
        self.login_as(self.ivan)  # не его предмет — созвона для него нет
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/answer/', {'task': 'cw-1', 'text': '1'}, format='json').status_code, 404)

    def test_old_call_is_hidden(self):
        call_id = self.start_call()
        Call.objects.filter(id=call_id).update(started_at=timezone.now() - Call.MAX_DURATION - timedelta(minutes=1))
        self.assertEqual(self.client.get('/api/calls/').data, [])

    def test_closed_for_students_until_enabled(self):
        call_id = self.start_call('')
        with override_settings(CALLS_STUDENTS=[]):
            self.login_as(self.anna)
            self.assertEqual(self.client.get('/api/calls/').data, [])
            self.assertEqual(self.client.post(f'/api/calls/{call_id}/join/').status_code, 404)
            self.login_as(self.teacher)
            self.assertEqual(len(self.client.get('/api/calls/').data), 1)
        with override_settings(CALLS_STUDENTS=['Anna']):  # только тестовый ученик
            self.login_as(self.anna)
            self.assertEqual(self.client.post(f'/api/calls/{call_id}/join/').status_code, 200)
            self.login_as(self.ivan)
            self.assertEqual(self.client.get('/api/calls/').data, [])

    def test_personal_call(self):
        self.login_as(self.teacher)
        response = self.client.post('/api/calls/', {'student': self.anna.id, 'subject': 'Биология'}, format='json')
        self.assertEqual(response.status_code, 201)
        call_id = response.data['id']
        self.assertEqual(response.data['student_name'], 'anna')
        self.assertEqual(response.data['subject'], '')
        self.login_as(self.ivan)
        self.assertEqual(self.client.get('/api/calls/').data, [])
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/join/').status_code, 404)
        with override_settings(CALLS_STUDENTS=[]):  # личный урок виден, даже пока созвоны закрыты
            self.login_as(self.anna)
            self.assertEqual([c['id'] for c in self.client.get('/api/calls/').data], [call_id])
            self.assertEqual(self.client.post(f'/api/calls/{call_id}/join/').status_code, 200)

    def test_personal_call_only_for_student(self):
        self.login_as(self.teacher)
        response = self.client.post('/api/calls/', {'student': self.teacher.id}, format='json')
        self.assertEqual(response.status_code, 400)

    @override_settings(LIVEKIT_API_KEY='', LIVEKIT_API_SECRET='')
    def test_not_configured(self):
        call_id = self.start_call()
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/join/').status_code, 503)


FIGURE = r"""\begin{tikzpicture}
  \draw (0,0) -- (1,1); % диагональ
  \node {50\%};
\end{tikzpicture}"""
FIGURE_KEY = r'\begin{tikzpicture} \draw (0,0) -- (1,1); \node {50\%}; \end{tikzpicture}'


class TikzFiguresTests(AuthTestCase):
    def lesson(self, **fields):
        return Assignment.objects.create(title='Урок', subject='Биология', **fields)

    def figures(self, account, lesson):
        self.login_as(account)
        return self.client.get(f'/api/assignments/{lesson.pk}/').data['figures']

    def test_extract_matches_frontend_key(self):
        self.assertEqual(extract_figures(f'Текст {FIGURE} и снова {FIGURE}'), [FIGURE_KEY])

    def test_commented_figure_is_skipped(self):
        self.assertEqual(extract_figures('% ' + r'\begin{tikzpicture}\end{tikzpicture}' + '\nТекст'), [])

    def test_saving_queues_figures_from_all_task_fields_once(self):
        lesson = self.lesson(tasks_latex=FIGURE, numbered_tasks=[{'number': 1, 'latex': FIGURE}])
        Homework.objects.create(assignment=lesson, description='', tasks_latex=r'\begin{tikzpicture}\draw (0,0);\end{tikzpicture}')
        self.assertEqual(TikzFigure.objects.filter(status=TikzFigure.PENDING).count(), 2)

    def test_rendering_starts_after_commit(self):
        with patch('api.tikz.start_rendering') as start, self.captureOnCommitCallbacks(execute=True):
            self.lesson(tasks_latex=FIGURE)
        start.assert_called_once()

    def test_ready_figure_is_not_rendered_again(self):
        self.lesson(tasks_latex=FIGURE)
        TikzFigure.objects.update(status=TikzFigure.READY)
        with patch('api.tikz.start_rendering') as start, self.captureOnCommitCallbacks(execute=True):
            self.lesson(tasks_latex=FIGURE)
        start.assert_not_called()
        self.assertEqual(TikzFigure.objects.count(), 1)

    def test_ready_figure_has_signed_url(self):
        lesson = self.lesson(tasks_latex=FIGURE)
        with tempfile.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            with patch('api.tikz.compile_svg', return_value=b'<svg/>'):
                render_pending()
            [figure] = self.figures(self.anna, lesson)
        self.assertEqual(figure['source'], FIGURE_KEY)
        self.assertEqual(figure['status'], 'ok')
        self.assertIn('/media/tikz/', figure['url'])
        self.assertIn('?s=', figure['url'])

    def test_error_is_shown_only_to_teacher(self):
        lesson = self.lesson(tasks_latex=FIGURE)
        with patch('api.tikz.compile_svg', side_effect=TikzError('Undefined control sequence')):
            render_pending()
        self.assertEqual(self.figures(self.teacher, lesson)[0]['error'], 'Undefined control sequence')
        self.assertNotIn('error', self.figures(self.anna, lesson)[0])

    def test_finished_figure_refreshes_open_pages(self):
        self.lesson(tasks_latex=FIGURE)
        before = DataVersion.current()
        with patch('api.tikz.compile_svg', side_effect=TikzError('нет')):
            render_pending()
        self.assertGreater(DataVersion.current(), before)

    def test_tex_gets_no_secrets_from_environment(self):
        with patch.dict(os.environ, {'GIGACHAT_KEY': 'secret'}), patch('api.tikz.subprocess.run') as run:
            tikz_run(['xelatex'], '.')
        env = run.call_args.kwargs['env']
        self.assertNotIn('GIGACHAT_KEY', env)
        self.assertEqual((env['openin_any'], env['shell_escape']), ('p', 'f'))

    def test_too_long_figure_is_rejected(self):
        with self.assertRaises(TikzError):
            compile_svg('x' * (MAX_SOURCE_LENGTH + 1))

    def test_svg_size_is_set_in_points(self):
        self.assertIn('width="10.5pt" height="20pt"', _in_points('<svg xmlns="a" width="10.5" height="20" viewBox="0 0 1 1">'))


@override_settings(LIVEKIT_API_KEY='testkey', LIVEKIT_API_SECRET='testsecret', LIVEKIT_URL='', LIVEKIT_API_HOST='',
                   CALLS_STUDENTS=['*'], PUSH_SYNC=True)
class PushTests(AuthTestCase):
    """Уведомления в браузер о начале урока"""
    def subscribe(self, account, endpoint):
        self.login_as(account)
        return self.client.post('/api/push/', {
            'endpoint': endpoint, 'keys': {'p256dh': 'BKey', 'auth': 'secret'},
        }, format='json')

    def test_public_key_and_subscribe(self):
        self.login_as(self.anna)
        key = self.client.get('/api/push/').data['public_key']
        # Публичный ключ P-256 в несжатом виде: 65 байт → 87 знаков base64url
        self.assertEqual(len(key), 87)
        self.assertEqual(self.client.get('/api/push/').data['public_key'], key)  # ключ один и тот же
        self.assertEqual(self.subscribe(self.anna, 'https://push.example/1').status_code, 204)
        self.assertEqual(self.subscribe(self.anna, 'http://evil/1').status_code, 400)
        # Тот же браузер под другим аккаунтом — подписка переходит к нему
        self.subscribe(self.ivan, 'https://push.example/1')
        self.assertEqual(PushSubscription.objects.get().account, self.ivan)
        self.client.delete('/api/push/', {'endpoint': 'https://push.example/1'}, format='json')
        self.assertFalse(PushSubscription.objects.exists())

    def test_anonymous_cannot_subscribe(self):
        self.assertEqual(self.client.get('/api/push/').status_code, 401)

    @patch('pywebpush.webpush')
    def test_call_start_notifies_students_of_subject(self, webpush):
        self.subscribe(self.anna, 'https://push.example/anna')
        self.subscribe(self.ivan, 'https://push.example/ivan')
        self.login_as(self.teacher)
        response = self.client.post('/api/calls/', {'subject': 'Биология', 'title': 'Фотосинтез'}, format='json')
        self.assertEqual(response.status_code, 201)
        # Урок по биологии — уведомление только Анне
        self.assertEqual(webpush.call_count, 1)
        kwargs = webpush.call_args.kwargs
        self.assertEqual(kwargs['subscription_info']['endpoint'], 'https://push.example/anna')
        payload = json.loads(kwargs['data'])
        self.assertEqual(payload['title'], 'Начался урок: Фотосинтез')
        self.assertEqual(payload['url'], f"/call/{response.data['id']}")

    @patch('pywebpush.webpush')
    def test_personal_call_notifies_only_student(self, webpush):
        self.subscribe(self.anna, 'https://push.example/anna')
        self.subscribe(self.ivan, 'https://push.example/ivan')
        self.login_as(self.teacher)
        with override_settings(CALLS_STUDENTS=[]):
            self.client.post('/api/calls/', {'student': self.ivan.id, 'title': 'Личный'}, format='json')
        self.assertEqual([c.kwargs['subscription_info']['endpoint'] for c in webpush.call_args_list],
                         ['https://push.example/ivan'])

    def test_gone_subscription_is_removed(self):
        from pywebpush import WebPushException

        class Gone:
            status_code = 410
        self.subscribe(self.anna, 'https://push.example/old')
        self.login_as(self.teacher)
        with patch('pywebpush.webpush', side_effect=WebPushException('gone', response=Gone())):
            self.client.post('/api/calls/', {'subject': 'Биология'}, format='json')
        self.assertFalse(PushSubscription.objects.exists())

    def test_real_encryption_and_vapid_headers(self):
        """Настоящее шифрование и подпись — без сети: запрос перехватываем"""
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        browser_key = ec.generate_private_key(ec.SECP256R1())
        p256dh = base64.urlsafe_b64encode(browser_key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)).rstrip(b'=').decode()
        auth = base64.urlsafe_b64encode(os.urandom(16)).rstrip(b'=').decode()
        self.login_as(self.anna)
        self.client.post('/api/push/', {'endpoint': 'https://fcm.googleapis.com/fcm/send/x',
                                        'keys': {'p256dh': p256dh, 'auth': auth}}, format='json')

        class Ok:
            status_code = 201
            text = ''
            headers = {}
        with patch('requests.post', return_value=Ok()) as post:
            self.login_as(self.teacher)
            self.client.post('/api/calls/', {'subject': 'Биология', 'title': 'Урок'}, format='json')
        self.assertEqual(post.call_count, 1)
        headers = post.call_args.kwargs['headers']
        self.assertEqual(headers['content-encoding'], 'aes128gcm')
        self.assertTrue(headers['authorization'].startswith('vapid t='))
        self.assertGreater(len(post.call_args.kwargs['data']), 50)



class ParentLinkTests(AuthTestCase):
    """Ссылка для родителей: учитель выдаёт, родитель без входа видит процент выполнения ДЗ"""
    def setUp(self):
        super().setUp()
        hw = Homework.objects.create(assignment=self.bio, description='', numbered_tasks=[
            {'number': 1, 'latex': 'a'}, {'number': 2, 'latex': 'b'}, {'number': 3, 'latex': 'c'},
            {'number': 4, 'latex': 'd'}, {'number': 5, 'latex': ''},  # пустой номер ученик не видит
        ])
        HomeworkFile.objects.create(homework=hw, name='6.txt', task_number=6)  # файл без номера в списке не считается
        self.sh = StudentHomework.objects.create(
            assignment=self.bio, student=self.anna, status='accepted',
            task_answers={'hw-1': '42', 'hw-2': '  ', 'cw-1': '7'},
        )
        StudentHomeworkFile.objects.create(student_homework=self.sh, name='r.py', task_key='hw-3')
        # Урок без ДЗ в таблицу не попадает
        Assignment.objects.create(title='Клетка', subject='Биология')

    def link(self, student, method='get'):
        self.login_as(self.teacher)
        response = getattr(self.client, method)(f'/api/accounts/{student.id}/parent-link/')
        self.client.credentials()
        return response

    def test_parent_sees_homework_percent(self):
        token = self.link(self.anna).data['token']
        self.assertGreaterEqual(len(token), 30)
        data = self.client.get(f'/api/parent/{token}/').data
        self.assertEqual(data['student'], 'anna')
        self.assertEqual(len(data['homeworks']), 1)
        row = data['homeworks'][0]
        self.assertEqual((row['title'], row['total'], row['done'], row['percent']), ('Фотосинтез', 4, 2, 50))
        self.assertEqual(row['review'], 'accepted')
        self.assertEqual(row['date'], '2026-11-01')
        self.assertEqual(data['average'], 50)
        # Ни заданий, ни ответов родителю не отдаём
        self.assertNotIn('42', json.dumps(data, ensure_ascii=False))

    def test_link_is_stable_and_can_be_replaced(self):
        first = self.link(self.anna).data['token']
        self.assertEqual(self.link(self.anna).data['token'], first)
        second = self.link(self.anna, 'post').data['token']
        self.assertNotEqual(first, second)
        self.assertEqual(self.client.get(f'/api/parent/{first}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/parent/{second}/').status_code, 200)

    def test_only_teacher_gives_link_and_only_to_student(self):
        self.login_as(self.anna)
        self.assertEqual(self.client.get(f'/api/accounts/{self.anna.id}/parent-link/').status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.get(f'/api/accounts/{self.anna.id}/parent-link/').status_code, 401)
        self.assertEqual(self.link(self.teacher).status_code, 400)
        # Токен не виден в списке аккаунтов
        self.link(self.anna)
        self.login_as(self.teacher)
        self.assertNotIn('parent_token', json.dumps(self.client.get('/api/accounts/').data))

    def test_bad_token_and_stale_login_header(self):
        self.assertEqual(self.client.get('/api/parent/nope/').status_code, 404)
        token = self.link(self.anna).data['token']
        # Устаревший токен входа в браузере родителя не мешает
        self.client.credentials(HTTP_AUTHORIZATION='Token old')
        self.assertEqual(self.client.get(f'/api/parent/{token}/').status_code, 200)


class LessonTopicTests(AuthTestCase):
    """Папки-темы уроков: тема по названию, порядок перетаскиванием"""
    def test_guess_topic(self):
        from .topics import guess_topic
        self.assertEqual(guess_topic('26 задание урок 3'), '№26')
        self.assertEqual(guess_topic('7 задание'), '№7')
        self.assertEqual(guess_topic('27 задание итоговый тест'), '№27')
        self.assertEqual(guess_topic('5, 6, 14 задание повторение'), 'Повторение')
        self.assertEqual(guess_topic('подготовка к проверочной'), 'Проверочные')
        self.assertEqual(guess_topic('Фотосинтез'), '')

    def create(self, title, **extra):
        return self.client.post('/api/assignments/', {'title': title, 'subject': 'Биология', **extra}, format='json')

    def test_new_lesson_gets_topic_from_title_and_goes_last(self):
        self.login_as(self.teacher)
        first = self.create('26 задание урок 1').data
        second = self.create('26 задание урок 2').data
        self.assertEqual((first['topic'], second['topic']), ('№26', '№26'))
        self.assertGreater(second['position'], first['position'])
        self.assertEqual(self.create('Клетка', topic='  Своя   тема ').data['topic'], 'Своя тема')

    def test_reorder_and_move_to_other_topic(self):
        self.login_as(self.teacher)
        a = self.create('26 задание урок 1').data['id']
        b = self.create('26 задание урок 2').data['id']
        c = self.create('27 задание урок 1').data['id']
        response = self.client.post('/api/assignments/reorder/', {'topic': '№26', 'ids': [c, b, a]}, format='json')
        self.assertEqual(response.status_code, 200)
        lessons = {x.id: x for x in Assignment.objects.filter(id__in=[a, b, c])}
        self.assertEqual([lessons[i].topic for i in (a, b, c)], ['№26'] * 3)
        self.assertEqual([lessons[i].position for i in (c, b, a)], [1, 2, 3])
        # Ученику порядок и тема приходят, менять их он не может
        self.login_as(self.anna)
        data = self.client.get(f'/api/assignments/{a}/').data
        self.assertEqual((data['topic'], data['position']), ('№26', 3))
        self.assertEqual(self.client.post('/api/assignments/reorder/', {'topic': 'x', 'ids': [a]}, format='json').status_code, 403)

    def test_reorder_validates_ids(self):
        self.login_as(self.teacher)
        url = '/api/assignments/reorder/'
        self.assertEqual(self.client.post(url, {'topic': 'x', 'ids': []}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'topic': 'x', 'ids': [999999]}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'topic': 'x', 'ids': [self.bio.id, self.bio.id]}, format='json').status_code, 400)


class LessonDateTests(AuthTestCase):
    """День занятия: задаётся при создании, меняется и стирается учителем, приходит ученику"""
    def test_lesson_date(self):
        self.login_as(self.teacher)
        data = self.client.post('/api/assignments/', {'title': 'Клетка', 'subject': 'Биология', 'lesson_date': '2026-11-12'}).data
        self.assertEqual(data['lesson_date'], '2026-11-12')
        url = f"/api/assignments/{data['id']}/"
        self.assertEqual(self.client.patch(url, {'lesson_date': '2026-11-19'}).data['lesson_date'], '2026-11-19')
        self.assertIsNone(self.client.patch(url, {'lesson_date': ''}).data['lesson_date'])
        self.assertEqual(self.client.post('/api/assignments/', {'title': 'x', 'subject': 'Биология', 'lesson_date': 'завтра'}).status_code, 400)
        self.login_as(self.anna)
        self.assertIn('lesson_date', self.client.get(url).data)


class StreakTests(AuthTestCase):
    """Серия дней: активность ученика отмечает день, серия считается от сегодня или вчера"""
    def test_streak_counts_consecutive_days(self):
        from .models import ActivityDay
        from .streak import local_day
        today = local_day()
        for back in (1, 2, 3, 5, 6):  # вчера, позавчера, 3 дня назад; потом разрыв и ещё 2 дня
            ActivityDay.objects.create(student=self.anna, day=today - timedelta(days=back))
        self.login_as(self.anna)
        data = self.client.get('/api/accounts/streak/').data
        self.assertEqual((data['current'], data['best'], data['active_today']), (3, 3, False))
        self.assertEqual(len(data['week']), 7)
        self.assertEqual(data['week'][-1], {'date': today.isoformat(), 'active': False})
        # Ответ к заданию — сегодня тоже в серии
        self.bio.numbered_tasks = [{'number': 1, 'latex': 'x'}]
        self.bio.save()
        self.client.post(f'/api/assignments/{self.bio.id}/submit-task/', {'task': 'cw-1', 'text': '42'})
        data = self.client.get('/api/accounts/streak/').data
        self.assertEqual((data['current'], data['active_today']), (4, True))

    def test_broken_streak_and_teacher(self):
        from .models import ActivityDay
        from .streak import local_day
        ActivityDay.objects.create(student=self.anna, day=local_day() - timedelta(days=2))
        self.login_as(self.anna)
        self.assertEqual(self.client.get('/api/accounts/streak/').data['current'], 0)
        self.login_as(self.teacher)
        self.assertEqual(self.client.get('/api/accounts/streak/').status_code, 403)

    def test_typing_and_comment_mark_day(self):
        from .models import ActivityDay
        sh = StudentHomework.objects.create(assignment=self.bio, student=self.anna, description='x')
        self.login_as(self.anna)
        self.client.post(f'/api/student-homeworks/{sh.id}/comments/', {'text': 'Вопрос'}, format='json')
        self.assertEqual(ActivityDay.objects.filter(student=self.anna).count(), 1)
        # Учитель пишет — в серию ученика это не идёт, а у учителя серии нет
        self.login_as(self.teacher)
        self.client.post(f'/api/student-homeworks/{sh.id}/comments/', {'text': 'Ответ'}, format='json')
        self.assertEqual(ActivityDay.objects.count(), 1)
