"""Фото задания → LaTeX в стиле Spirit Code.

1. Tesseract переписывает текст с картинки — он точно передаёт числа и слова.
2. GigaChat получает уже готовый текст и только оформляет его: \\zadacha{N},
   жирные команды, переменные в $...$. Картинку модели не показываем — по фото
   она путала числа и «Направо/Налево».
3. Числа из текста Tesseract сравниваются с числами в LaTeX: если модель
   что-то потеряла или добавила, учитель видит предупреждение.

Настройки (переменные окружения): GIGACHAT_AUTH_KEY — ключ из кабинета
developers.sber.ru, GIGACHAT_SCOPE, GIGACHAT_MODEL. Сертификат GigaChat выдан
удостоверяющим центром Минцифры, его корневой сертификат лежит в certs/.
"""
import io
import json
import re
import ssl
import subprocess
import threading
import time
import uuid
from collections import Counter
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError

OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
CHAT_URL = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions'

# Фото с телефона уменьшаем: на 12 Мп Tesseract работает в разы дольше, а точнее не становится
MAX_IMAGE_SIDE = 3000
OCR_TIMEOUT = 60
GIGACHAT_TIMEOUT = 40

PROMPT = r"""Ниже текст задания, распознанный с фото программой OCR. Оформи его в LaTeX для платформы Spirit Code.
Правила:
- Выведи ТОЛЬКО тело документа, без преамбулы и \begin{document}. Без пояснений, без ```.
- Начни строкой \zadacha{NUM}.
- Текст сохраняй дословно. НЕ меняй числа, названия команд, слова «Направо/Налево», «по/против часовой» — даже если кажется, что там ошибка. Исправляй только явные ошибки распознавания: русская буква вместо латинской переменной (п, л → n; т → m; К → k), «Ha» вместо «на». Буквы-переменные не заменяй на другие: если в тексте S — пиши $S$.
- Одиночные латинские буквы-переменные (n, m, k, S, x …) оформляй как $n$. Формулы — в $...$. Обычные слова и названия команд в $...$ не заключай. Слова с номерами вроде «Команда1 Команда2 … КомандаS» пиши обычным текстом как есть — без $, без индексов, без \dots.
- Названия команд исполнителя в описании (например «Поднять хвост», «Вперёд n») и строки алгоритма выделяй \textbf{...}.
- Строки алгоритма, программы или кода переноси так же, как в исходном тексте: одна строка исходника — одна строка, в конце строки \\ . Не разбивай строку на отдельные команды.
- Дефис между словами, означающий тире, заменяй на «—».
- Абзацы разделяй пустой строкой. Указания авторов задач (например «(Л. Шастин)») удаляй.

Текст:
"""


class PhotoLatexError(Exception):
    """Ошибка, текст которой можно показать учителю"""


def prepare_image(uploaded):
    """Поворачивает фото по EXIF, уменьшает слишком большое и отдаёт PNG"""
    try:
        image = Image.open(uploaded)
        image = ImageOps.exif_transpose(image)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise PhotoLatexError('Не получилось открыть картинку. Подойдут JPG, PNG, WEBP, BMP.')
    image = image.convert('L')
    image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
    out = io.BytesIO()
    image.save(out, format='PNG')
    return out.getvalue()


def run_ocr(png):
    """Текст с картинки через Tesseract (русский + английский)"""
    try:
        result = subprocess.run(
            [settings.TESSERACT_CMD, 'stdin', 'stdout', '-l', 'rus+eng', '--psm', '6'],
            input=png, capture_output=True, timeout=OCR_TIMEOUT, check=True,
        )
    except FileNotFoundError:
        raise PhotoLatexError('На сервере не установлен Tesseract')
    except subprocess.TimeoutExpired:
        raise PhotoLatexError('Распознавание текста заняло слишком много времени')
    except subprocess.CalledProcessError:
        raise PhotoLatexError('Tesseract не смог прочитать картинку')
    text = result.stdout.decode('utf-8', errors='replace')
    # Курсивную S Tesseract читает как «$» («Команда$», «из $ команд»). Настоящий
    # доллар в заданиях почти не встречается, а одиночный «$» ломает формулы у модели
    text = text.replace('$', 'S')
    # Лишние пустые строки и пробелы в концах строк
    text = re.sub(r'[ \t]+\n', '\n', text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


class GigaChat:
    """Клиент GigaChat: токен живёт 30 минут, берём новый заранее"""

    def __init__(self):
        self._token = None
        self._expires_at = 0
        self._lock = threading.Lock()
        self._ssl = None

    def _context(self):
        if self._ssl is None:
            self._ssl = ssl.create_default_context(cafile=str(settings.GIGACHAT_CA_BUNDLE))
        return self._ssl

    def _post(self, url, headers, body):
        # Без системного прокси: GigaChat работает только из России
        opener = urlrequest.build_opener(
            urlrequest.ProxyHandler({}), urlrequest.HTTPSHandler(context=self._context()),
        )
        req = urlrequest.Request(url, data=body, headers=headers, method='POST')
        try:
            with opener.open(req, timeout=GIGACHAT_TIMEOUT) as resp:
                return json.loads(resp.read())
        except HTTPError as e:
            if e.code == 429:
                raise PhotoLatexError('Закончился лимит GigaChat — попробуйте позже')
            if e.code in (401, 403):
                raise PhotoLatexError('GigaChat не принял ключ — проверьте GIGACHAT_AUTH_KEY на сервере')
            raise PhotoLatexError(f'GigaChat ответил ошибкой {e.code}')
        except (URLError, TimeoutError, ssl.SSLError):
            raise PhotoLatexError('Нет связи с GigaChat — попробуйте позже')

    def token(self):
        with self._lock:
            if self._token and time.time() < self._expires_at - 60:
                return self._token
            data = self._post(OAUTH_URL, {
                'Authorization': f'Basic {settings.GIGACHAT_AUTH_KEY}',
                'RqUID': str(uuid.uuid4()),
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
            }, urlencode({'scope': settings.GIGACHAT_SCOPE}).encode())
            self._token = data['access_token']
            self._expires_at = data.get('expires_at', 0) / 1000  # приходит в миллисекундах
            return self._token

    def complete(self, prompt):
        data = self._post(CHAT_URL, {
            'Authorization': f'Bearer {self.token()}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }, json.dumps({
            'model': settings.GIGACHAT_MODEL,
            'temperature': 0.01,
            'messages': [{'role': 'user', 'content': prompt}],
        }).encode())
        try:
            return data['choices'][0]['message']['content']
        except (KeyError, IndexError, TypeError):
            raise PhotoLatexError('GigaChat вернул пустой ответ')


gigachat = GigaChat()


def clean_answer(text):
    """Убирает обёртку ```latex ... ```, если модель её всё-таки добавила"""
    text = text.strip()
    match = re.fullmatch(r'```[a-zA-Z]*\n(.*?)\n?```', text, flags=re.S)
    return (match.group(1) if match else text).strip()


def unwrap_text_math(latex):
    """Снимает $...$ с русских слов: модель любит писать «$Команда1$ Команда2$ …» формулой.
    Настоящие формулы (с индексами, степенями, знаками сравнения) не трогаем"""
    def repl(match):
        inner = match.group(1)
        if re.search(r'[А-Яа-яЁё]', inner) and not re.search(r'[_^{}=+<>]', inner):
            return re.sub(r'\\l?dots\b', '...', inner)
        return match.group(0)
    return re.sub(r'(?<!\\)\$([^$]*)(?<!\\)\$', repl, latex)


def numbers_diff(ocr_text, latex):
    """Какие числа пропали из LaTeX и какие появились — по сравнению с OCR"""
    latex = re.sub(r'\\zadacha\{\d+\}', '', latex)
    source = Counter(re.findall(r'\d+', ocr_text))
    result = Counter(re.findall(r'\d+', latex))
    return sorted((source - result).elements(), key=int), sorted((result - source).elements(), key=int)


def photo_to_latex(uploaded, number=1):
    """Главная функция: фото → {latex, ocr_text, warnings}"""
    if not settings.GIGACHAT_AUTH_KEY:
        raise PhotoLatexError('Распознавание не настроено: на сервере нет ключа GigaChat')
    ocr_text = run_ocr(prepare_image(uploaded))
    if len(re.sub(r'\W', '', ocr_text)) < 10:
        raise PhotoLatexError('На фото не найден текст. Попробуйте снимок чётче и ровнее.')
    latex = unwrap_text_math(clean_answer(gigachat.complete(PROMPT.replace('NUM', str(number)) + ocr_text)))
    if not latex.startswith('\\zadacha'):
        latex = f'\\zadacha{{{number}}}\n\n{latex}'

    warnings = []
    lost, added = numbers_diff(ocr_text, latex)
    if lost or added:
        parts = []
        if lost:
            parts.append('пропали ' + ', '.join(lost))
        if added:
            parts.append('появились ' + ', '.join(added))
        warnings.append(
            'Проверьте числа: по сравнению с распознанным текстом ' + '; '.join(parts) + '. '
            'Иногда это исправленная ошибка распознавания (например, «7» вместо буквы «т»), '
            'но лучше сверить с фото.'
        )
    if len(re.findall(r'(?<!\\)\$', latex)) % 2:
        warnings.append('Похоже, в тексте есть незакрытая формула (нечётное число знаков $) — '
                        'проверьте предпросмотр.')
    return {'latex': latex, 'ocr_text': ocr_text, 'warnings': warnings}
