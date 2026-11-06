"""Рисунки TikZ в заданиях: при сохранении сервер собирает их настоящим TeX в SVG.

Браузер LaTeX не компилирует, поэтому рисунок готовится здесь один раз, а ученики
получают обычную картинку. Одинаковый рисунок собирается один раз на весь сайт:
TikzFigure ищется по хэшу текста. Сборка идёт в фоне и строго по одному рисунку —
на сервере мало памяти, а урок при этом может идти. Когда рисунок готов, растёт номер
версии данных, и открытые страницы подгружают его сами (см. signals.py).

Подпись рисунка на фронте — та же строка: держать source_key в согласии с figureKey
в src/utils/latex.ts, иначе страница не найдёт свой рисунок.
"""
import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import connections, transaction

from .models import TikzFigure

try:
    import fcntl
except ImportError:  # Windows, локальная разработка: там один процесс
    fcntl = None

logger = logging.getLogger(__name__)

MAX_SOURCE_LENGTH = 20_000
MAX_SVG_BYTES = 3 * 1024 * 1024
TEX_TIMEOUT_SECONDS = 40
TEX_MEMORY_BYTES = 1024 * 1024 * 1024
PADDING = '2pt'  # чтобы толщина линий на краю рисунка не обрезалась

# Шрифт Вектор кладётся сюда: Vektor-Regular/Bold/Italic/BoldItalic.ttf.
# Если файлов нет, рисунки собираются шрифтом DejaVu Sans (кириллица в нём есть).
FONTS_DIR = Path(settings.BASE_DIR) / 'fonts'

_COMMENT_RE = re.compile(r'(\\.)|%[^\n]*(?:\n[ \t]*)?', re.S)
_FIGURE_RE = re.compile(r'\\begin\{tikzpicture\}.*?\\end\{tikzpicture\}', re.S)
_ROOT_SIZE_RE = re.compile(r'(<svg\b[^>]*?\bwidth=")([\d.]+)("[^>]*?\bheight=")([\d.]+)(")')

# Только то, без чего не запускается TeX. Секреты Django в процесс TeX не попадают
_ENV_KEEP = ('PATH', 'HOME', 'LANG', 'SYSTEMROOT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP')

_FONT_FALLBACK = r'\setmainfont{DejaVu Sans}'
_FONT_VEKTOR = r"""
\setmainfont{Vektor}[
  Path = fonts/, Extension = .ttf,
  UprightFont = *-Regular, BoldFont = *-Bold,
  ItalicFont = *-Italic, BoldItalicFont = *-BoldItalic]
\usepackage{unicode-math}
\setmathfont{Latin Modern Math}
\setmathfont{Vektor-Italic.ttf}[Path = fonts/, range = it/{latin,Latin}]
\setmathfont{Vektor-Regular.ttf}[Path = fonts/, range = {up/{latin,Latin,num}, "2B, "3D, \times, "28, "29, "7C, "2C, "2E}]
"""

_DOCUMENT = r"""\documentclass[12pt]{article}
\usepackage{amsmath}
\usepackage{fontspec}
%(font)s
\usepackage{tikz}
\usetikzlibrary{arrows.meta,calc,positioning,shapes.geometric,patterns,fit,backgrounds,
  decorations.pathreplacing,intersections,angles,quotes,automata,graphs}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usepgfplotslibrary{fillbetween}
\definecolor{vekorange}{HTML}{FF8400}
\newsavebox\figurebox
\begin{document}
\sbox\figurebox{%(source)s}
\ifdim\wd\figurebox=0pt \errmessage{Пустой рисунок}\fi
\pdfpagewidth=\dimexpr\wd\figurebox+2\dimexpr%(padding)s\relax\relax
\pdfpageheight=\dimexpr\ht\figurebox+\dp\figurebox+2\dimexpr%(padding)s\relax\relax
\hoffset=\dimexpr-1in+%(padding)s\relax
\voffset=\dimexpr-1in+%(padding)s\relax
\shipout\box\figurebox
\end{document}
"""


class TikzError(Exception):
    """Рисунок не собрался; текст показывается учителю"""


def strip_comments(text):
    """Как stripComments в src/utils/latex.ts: \\% остаётся, комментарий съедает конец строки"""
    return _COMMENT_RE.sub(lambda m: m.group(1) or '', text)


def source_key(source):
    return hashlib.sha256(source.encode('utf-8')).hexdigest()


def extract_figures(text):
    """Все рисунки из LaTeX: без комментариев и лишних пробелов, без повторов"""
    found = (re.sub(r'\s+', ' ', m).strip() for m in _FIGURE_RE.findall(strip_comments(text or '')))
    return list(dict.fromkeys(found))


def task_sources(obj):
    """Рисунки урока или ДЗ: у них одинаковые поля с заданиями"""
    texts = [obj.tasks_latex]
    texts += [t.get('latex', '') for t in obj.numbered_tasks or [] if isinstance(t, dict)]
    return list(dict.fromkeys(s for text in texts if 'tikzpicture' in (text or '') for s in extract_figures(text)))


def assignment_sources(assignment):
    """Рисунки всего урока: классная работа и ДЗ"""
    homework = getattr(assignment, 'homework', None)
    sources = task_sources(assignment) + (task_sources(homework) if homework else [])
    return list(dict.fromkeys(sources))


def queue_figures(obj):
    """Заводит записи о новых рисунках и после сохранения запускает сборку"""
    sources = task_sources(obj)
    if not sources:
        return
    keys = {source_key(s): s for s in sources}
    known = set(TikzFigure.objects.filter(key__in=keys).values_list('key', flat=True))
    for key, source in keys.items():
        if key not in known:
            TikzFigure.objects.get_or_create(key=key, defaults={'source': source})
    if TikzFigure.objects.filter(key__in=keys, status=TikzFigure.PENDING).exists():
        transaction.on_commit(start_rendering)


def start_rendering():
    threading.Thread(target=_render_in_background, name='tikz', daemon=True).start()


def _render_in_background():
    try:
        render_pending()
    except Exception:
        logger.exception('Сборка рисунков TikZ остановилась')
    finally:
        connections.close_all()  # соединения с БД у каждого потока свои


_thread_lock = threading.Lock()


@contextmanager
def _one_at_a_time():
    """Один TeX на весь сервер: и между потоками, и между процессами gunicorn"""
    with _thread_lock:
        if fcntl is None:
            yield
            return
        with open(Path(tempfile.gettempdir()) / 'spirit-tikz.lock', 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield


def render_pending():
    """Собирает рисунки, которые ждут очереди. Запись, оставшаяся от упавшего
    процесса, тоже ждёт — её подберёт следующая сборка или команда render_tikz"""
    with _one_at_a_time():
        while figure := TikzFigure.objects.filter(status=TikzFigure.PENDING).order_by('id').first():
            _render(figure)


def _render(figure):
    try:
        svg = compile_svg(figure.source)
    except TikzError as e:
        figure.status, figure.error = TikzFigure.ERROR, str(e)
    except Exception:
        logger.exception('Рисунок TikZ %s', figure.key)
        figure.status, figure.error = TikzFigure.ERROR, 'Сервер не смог собрать рисунок'
    else:
        figure.svg.save(f'{figure.key}.svg', ContentFile(svg), save=False)
        figure.status, figure.error = TikzFigure.READY, ''
    figure.save()


def compile_svg(source):
    """TikZ → SVG. Буквы в SVG становятся контурами, шрифты ученику не нужны"""
    if len(source) > MAX_SOURCE_LENGTH:
        raise TikzError(f'Рисунок длиннее {MAX_SOURCE_LENGTH} знаков')
    xelatex, pdftocairo = _tool('xelatex'), _tool('pdftocairo')

    with tempfile.TemporaryDirectory(prefix='tikz-') as tmp:
        work = Path(tmp)
        has_vektor = (FONTS_DIR / 'Vektor-Regular.ttf').exists()
        if has_vektor:
            shutil.copytree(FONTS_DIR, work / 'fonts')  # из рабочей папки: TeX читает только её
        (work / 'figure.tex').write_text(_DOCUMENT % {
            'font': _FONT_VEKTOR if has_vektor else _FONT_FALLBACK,
            'source': source,
            'padding': PADDING,
        }, encoding='utf-8')

        result = _run([xelatex, '-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'figure.tex'], work)
        if result.returncode != 0 or not (work / 'figure.pdf').exists():
            raise TikzError(_tex_error(work / 'figure.log'))
        result = _run([pdftocairo, '-svg', 'figure.pdf', 'figure.svg'], work)
        if result.returncode != 0:
            raise TikzError('Не получилось сделать из рисунка SVG')

        svg = (work / 'figure.svg').read_bytes()
    if len(svg) > MAX_SVG_BYTES:
        raise TikzError('Рисунок получился слишком большим')
    return _in_points(svg.decode('utf-8')).encode('utf-8')


def _tool(name):
    path = shutil.which(name, path=os.pathsep.join(filter(None, [os.environ.get('TIKZ_BIN_DIR'), os.environ.get('PATH')])))
    if not path:
        raise TikzError(f'На сервере не установлен {name}')
    return path


def _run(command, cwd):
    env = {key: os.environ[key] for key in _ENV_KEEP if key in os.environ}
    env.update(openin_any='p', openout_any='p', shell_escape='f')
    prlimit = shutil.which('prlimit')
    if prlimit:
        command = [prlimit, f'--as={TEX_MEMORY_BYTES}', '--', *command]
    try:
        return subprocess.run(
            command, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=TEX_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        raise TikzError('Рисунок собирался слишком долго') from None


def _tex_error(log_path):
    """Первая ошибка из журнала TeX: сообщение и строка с местом"""
    try:
        lines = log_path.read_text(encoding='utf-8', errors='replace').splitlines()
    except OSError:
        return 'TeX не запустился'
    for i, line in enumerate(lines):
        if line.startswith('!'):
            place = next((l for l in lines[i + 1:i + 30] if l.startswith('l.')), '')
            return f'{line[1:].strip()} {place}'.strip()[:500]
    return 'TeX завершился с ошибкой'


def _in_points(svg):
    """pdftocairo пишет размеры в пунктах без единиц, а браузер считает их пикселями:
    рисунок выходил бы на четверть мельче. Размер шрифта 12pt остаётся настоящим"""
    return _ROOT_SIZE_RE.sub(r'\g<1>\g<2>pt\g<3>\g<4>pt\g<5>', svg, count=1)
