// Свой модуль turtle для Python в браузере: настоящего (через tkinter) в Pyodide нет.
// Черепаха ничего не рисует сама, а записывает линии, точки и заливки;
// после запуска картинку рисует страница (TurtleCanvas). Анимации нет — сразу результат.

// Что нарисовала черепаха — то, что отдаёт turtle._export()
export interface TurtleDrawing {
  lines: [number, number, number, number, string, number][] // x1, y1, x2, y2, цвет, толщина
  dots: [number, number, number, string][] // x, y, диаметр, цвет
  fills: [number[], string][] // [x1, y1, x2, y2, …], цвет
  texts: [number, number, string, string][] // x, y, текст, цвет
  turtles: [number, number, number, string][] // где стоят видимые черепахи: x, y, курс, цвет
  bg: string
  truncated: boolean
}

export const TURTLE_MODULE = String.raw`
"""Черепаха Spirit Code: записывает рисунок, его рисует страница."""
import math as _math
import json as _json

_MAX_ITEMS = 300000
_lines, _dots, _fills, _texts = [], [], [], []
_all_turtles = []
_state = {'bg': 'white', 'truncated': False}


def _room():
    if len(_lines) + len(_dots) + len(_fills) + len(_texts) >= _MAX_ITEMS:
        _state['truncated'] = True
        return False
    return True


def _color(args):
    if not args:
        return None
    if len(args) == 1:
        c = args[0]
        if isinstance(c, (tuple, list)) and len(c) == 3:
            return _rgb(*c)
        return str(c)
    if len(args) == 3:
        return _rgb(*args)
    return str(args[0])


def _rgb(r, g, b):
    # Цвет числами: 0…1 (как в turtle по умолчанию) или 0…255 (colormode(255))
    if max(r, g, b) <= 1:
        r, g, b = r * 255, g * 255, b * 255
    return 'rgb(%d,%d,%d)' % (round(r), round(g), round(b))


class Turtle:
    def __init__(self, *args, **kwargs):
        self._reset()
        _all_turtles.append(self)

    def _reset(self):
        self._x = 0.0
        self._y = 0.0
        self._heading = 0.0
        self._down = True
        self._pencolor = 'black'
        self._fillcolor = 'black'
        self._width = 1
        self._visible = True
        self._fill = None
        self._degrees = 360.0

    # --- движение ---
    def _move_to(self, x, y):
        x, y = float(x), float(y)
        if self._down and _room():
            _lines.append([self._x, self._y, x, y, self._pencolor, self._width])
        if self._fill is not None:
            self._fill.extend([x, y])
        self._x, self._y = x, y

    def forward(self, distance):
        a = _math.radians(self._heading * 360.0 / self._degrees)
        self._move_to(self._x + distance * _math.cos(a), self._y + distance * _math.sin(a))

    def backward(self, distance):
        self.forward(-distance)

    def left(self, angle):
        self._heading = (self._heading + angle) % self._degrees

    def right(self, angle):
        self._heading = (self._heading - angle) % self._degrees

    def goto(self, x, y=None):
        if y is None:
            x, y = x
        self._move_to(x, y)

    def setx(self, x):
        self._move_to(x, self._y)

    def sety(self, y):
        self._move_to(self._x, y)

    def setheading(self, angle):
        self._heading = angle % self._degrees

    def home(self):
        self._move_to(0, 0)
        self._heading = 0.0

    def circle(self, radius, extent=None, steps=None):
        if extent is None:
            extent = self._degrees
        full = extent * 360.0 / self._degrees
        if steps is None:
            steps = max(int(min(11 + abs(radius) / 6.0, 59.0) * abs(full) / 360.0), 1) * 3
        w = full / steps
        l = 2.0 * radius * _math.sin(_math.radians(w) / 2.0)
        if radius < 0:
            l, w = -l, -w
        unit = self._degrees / 360.0
        self.left(w / 2.0 * unit)
        for _ in range(steps):
            self.forward(l)
            self.left(w * unit)
        self.right(w / 2.0 * unit)

    def dot(self, size=None, *color):
        if size is not None and not isinstance(size, (int, float)):
            color = (size,) + color
            size = None
        if size is None:
            size = max(self._width + 4, self._width * 2)
        if _room():
            _dots.append([self._x, self._y, float(size), _color(color) or self._pencolor])

    def stamp(self):
        self.dot(8)
        return 0

    def write(self, arg, move=False, align='left', font=None):
        if _room():
            _texts.append([self._x, self._y, str(arg), self._pencolor])

    # --- перо ---
    def penup(self):
        self._down = False

    def pendown(self):
        self._down = True

    def isdown(self):
        return self._down

    def pensize(self, width=None):
        if width is None:
            return self._width
        self._width = width

    def pencolor(self, *args):
        if not args:
            return self._pencolor
        self._pencolor = _color(args)

    def fillcolor(self, *args):
        if not args:
            return self._fillcolor
        self._fillcolor = _color(args)

    def color(self, *args):
        if not args:
            return self._pencolor, self._fillcolor
        if len(args) == 2:
            self._pencolor, self._fillcolor = _color(args[:1]), _color(args[1:])
        else:
            self._pencolor = self._fillcolor = _color(args)

    def begin_fill(self):
        self._fill = [self._x, self._y]

    def end_fill(self):
        if self._fill is not None and len(self._fill) >= 6 and _room():
            _fills.append([self._fill, self._fillcolor])
        self._fill = None

    def filling(self):
        return self._fill is not None

    # --- что известно о черепахе ---
    def position(self):
        return Vec2D(self._x, self._y)

    def xcor(self):
        return self._x

    def ycor(self):
        return self._y

    def heading(self):
        return self._heading

    def towards(self, x, y=None):
        if y is None:
            x, y = x
        return _math.degrees(_math.atan2(y - self._y, x - self._x)) % 360.0 * self._degrees / 360.0

    def distance(self, x, y=None):
        if y is None:
            x, y = x
        return _math.hypot(x - self._x, y - self._y)

    def degrees(self, fullcircle=360.0):
        self._degrees = fullcircle

    def radians(self):
        self._degrees = 2 * _math.pi

    # --- видимость и прочее, что на картинку не влияет ---
    def hideturtle(self):
        self._visible = False

    def showturtle(self):
        self._visible = True

    def isvisible(self):
        return self._visible

    def speed(self, *args):
        return 0

    def shape(self, *args):
        return 'classic'

    def shapesize(self, *args, **kwargs):
        pass

    def clear(self):
        pass

    def reset(self):
        self._reset()

    def getscreen(self):
        return _screen

    fd = forward
    bk = back = backward
    lt = left
    rt = right
    setpos = setposition = goto
    seth = setheading
    pu = up = penup
    pd = down = pendown
    width = pensize
    pos = position
    ht = hideturtle
    st = showturtle
    turtlesize = shapesize


class Vec2D(tuple):
    def __new__(cls, x, y):
        return tuple.__new__(cls, (x, y))

    def __add__(self, other):
        return Vec2D(self[0] + other[0], self[1] + other[1])

    def __sub__(self, other):
        return Vec2D(self[0] - other[0], self[1] - other[1])

    def __abs__(self):
        return _math.hypot(self[0], self[1])

    def __repr__(self):
        return '(%.2f,%.2f)' % self


class _Screen:
    def bgcolor(self, *args):
        if args:
            _state['bg'] = _color(args)
        return _state['bg']

    def _noop(self, *args, **kwargs):
        return None

    setup = screensize = tracer = update = delay = mode = colormode = title = _noop
    listen = onkey = onkeypress = onclick = onscreenclick = ontimer = _noop
    mainloop = done = exitonclick = bye = _noop

    def window_width(self):
        return 800

    def window_height(self):
        return 600

    def turtles(self):
        return list(_all_turtles)


_screen = _Screen()


def Screen():
    return _screen


Pen = RawTurtle = Turtle
_default = None


def _t():
    global _default
    if _default is None:
        _default = Turtle()
    return _default


def _export():
    turtles = [[t._x, t._y, t._heading * 360.0 / t._degrees, t._pencolor] for t in _all_turtles if t._visible]
    return _json.dumps({'lines': _lines, 'dots': _dots, 'fills': _fills, 'texts': _texts,
                        'turtles': turtles, 'bg': _state['bg'], 'truncated': _state['truncated']})


def _make(name):
    def f(*args, **kwargs):
        return getattr(_t(), name)(*args, **kwargs)
    f.__name__ = name
    return f


for _name in ['forward', 'fd', 'backward', 'bk', 'back', 'left', 'lt', 'right', 'rt', 'goto', 'setpos',
              'setposition', 'setx', 'sety', 'setheading', 'seth', 'home', 'circle', 'dot', 'stamp', 'write',
              'penup', 'pu', 'up', 'pendown', 'pd', 'down', 'isdown', 'pensize', 'width', 'pencolor',
              'fillcolor', 'color', 'begin_fill', 'end_fill', 'filling', 'position', 'pos', 'xcor', 'ycor',
              'heading', 'towards', 'distance', 'degrees', 'radians', 'hideturtle', 'ht', 'showturtle', 'st',
              'isvisible', 'speed', 'shape', 'shapesize', 'turtlesize', 'clear', 'reset']:
    globals()[_name] = _make(_name)

for _name in ['bgcolor', 'setup', 'screensize', 'tracer', 'update', 'delay', 'mode', 'colormode', 'title',
              'listen', 'onkey', 'onkeypress', 'onclick', 'onscreenclick', 'ontimer', 'mainloop', 'done',
              'exitonclick', 'bye', 'window_width', 'window_height', 'turtles']:
    globals()[_name] = getattr(_screen, _name)

getscreen = Screen
__all__ = [n for n in globals() if not n.startswith('_') and n not in ('Vec2D',)] + ['Vec2D']
`
