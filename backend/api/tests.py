import json
import os
import shutil
import tempfile
from datetime import timedelta
from urllib.parse import urlsplit

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from .models import Account, Assignment, AuthToken, LessonFile, StudentHomework, StudentHomeworkFile


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
