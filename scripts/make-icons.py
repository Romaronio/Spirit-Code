"""Иконки приложения Spirit Code (PWA) — логотип из шапки сайта: тёмный квадрат с оранжевым «>_».

Рисуем фигурами, а не шрифтом, чтобы иконка не зависела от установленных шрифтов.
Запуск из корня проекта: backend\\.venv\\Scripts\\python.exe scripts\\make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

DARK = (42, 28, 18)  # --text
ORANGE = (255, 132, 0)  # --accent
OUT = Path(__file__).resolve().parent.parent / 'public'
SCALE = 4  # рисуем крупнее и уменьшаем — так края гладкие


def draw_mark(draw, size, inset):
    """«>_» в квадрате size×size; inset — доля поля по краям (для maskable — безопасная зона)"""
    def p(x, y):  # координаты в сетке 512, сжатые к центру на inset
        k = 1 - 2 * inset
        return ((inset + x / 512 * k) * size, (inset + y / 512 * k) * size)

    width = 46 / 512 * (1 - 2 * inset) * size
    chevron = [p(150, 166), p(262, 256), p(150, 346)]
    draw.line(chevron, fill=ORANGE, width=round(width), joint='curve')
    for x, y in (chevron[0], chevron[2]):  # круглые концы
        r = width / 2
        draw.ellipse((x - r, y - r, x + r, y + r), fill=ORANGE)
    x0, y0 = p(286, 322)
    x1, y1 = p(378, 368)
    draw.rounded_rectangle((x0, y0, x1, y1), radius=width / 2, fill=ORANGE)


def icon(size, *, rounded, inset=0.0):
    big = size * SCALE
    image = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if rounded:
        draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=big * 0.22, fill=DARK)
    else:
        draw.rectangle((0, 0, big, big), fill=DARK)  # maskable и iPhone: фон до краёв, форму задаёт система
    draw_mark(draw, big, inset)
    return image.resize((size, size), Image.LANCZOS)


def main():
    (OUT / 'icons').mkdir(exist_ok=True)
    icon(192, rounded=True).save(OUT / 'icons' / 'icon-192.png')
    icon(512, rounded=True).save(OUT / 'icons' / 'icon-512.png')
    # Android обрезает иконку кругом или квадратом — знак держим в центральных 80%
    icon(512, rounded=False, inset=0.12).save(OUT / 'icons' / 'icon-maskable-512.png')
    icon(180, rounded=False, inset=0.06).convert('RGB').save(OUT / 'apple-touch-icon.png')
    print('Готово:', ', '.join(str(p.relative_to(OUT)) for p in sorted(OUT.rglob('*.png'))))


if __name__ == '__main__':
    main()
