from datetime import timedelta

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from .models import Account, Assignment, AuthToken, StudentHomework


class AuthTestCase(APITestCase):
    def setUp(self):
        cache.clear()  # сбрасываем лимит попыток входа между тестами
        self.teacher = self.make_account('roman', 'teacher')
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

    def test_student_cannot_submit_to_foreign_subject(self):
        self.login_as(self.anna)
        response = self.client.post(f'/api/assignments/{self.eng.id}/submit/', {'description': 'x'})
        self.assertEqual(response.status_code, 404)

    def test_teacher_cannot_submit(self):
        self.login_as(self.teacher)
        response = self.client.post(f'/api/assignments/{self.bio.id}/submit/', {'description': 'x'})
        self.assertEqual(response.status_code, 403)

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
