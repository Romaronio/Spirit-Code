import type { TypingLanguage } from '../types'

// Частые слова без знаков препинания и заглавных букв — для тренажёра печати
const RU = `
и в не на я быть он с что а по это она этот к но они мы как из у который то за свой
весь год от так о для ты же все тот мочь вы человек такой его сказать только или ещё
бы себя один как уже до время если сам когда другой вот говорить наш мой знать стать
при чтобы дело жизнь кто первый очень два день её новый рука даже во со раз где там
под можно ну какой после их работа без самый потом надо хотеть ли слово идти большой
должен место иметь ничто то сейчас тут лицо каждый друг нет теперь ни глаз тоже тогда
видеть вопрос через да здесь дом сторона думать сделать страна жить чем мир об последний
случай голова более делать что-то смотреть ребёнок просто конечно сила российский конец
перед несколько вид система всегда работать между три нет понять пойти часть спросить
город дать также никто понимать получить отношение лишь второй именно говорить почему
вода стоять маленький мама папа школа урок книга задача ответ число учитель ученик
класс окно дверь стол стул лето зима весна осень утро вечер ночь солнце небо земля море
река лес поле дорога машина поезд письмо ручка тетрадь память компьютер программа код
сеть игра музыка песня цвет белый чёрный красный синий зелёный жёлтый тёплый холодный
быстро медленно хорошо плохо громко тихо высокий низкий новый старый молодой добрый
`

const EN = `
the be to of and a in that have it for not on with he as you do at this but his by
from they we say her she or an will my one all would there their what so up out if
about who get which go me when make can like time no just him know take people into
year your good some could them see other than then now look only come its over think
also back after use two how our work first well way even new want because any these
give day most us great small world school student teacher lesson book write read code
program computer number answer question idea home house water light night morning
music game green blue black white red yellow cold warm fast slow happy friend family
city country road car train letter paper table window door summer winter spring river
sea sky sun tree forest field learn study begin open close start stop help play run
walk talk call ask tell find keep hold bring turn move live believe change follow
`

// Ключевые слова, функции и методы Python, которые встречаются в задачах ЕГЭ
// по информатике. Регистр важен: True, None, Counter печатаются как в коде.
const EGE = `
if elif else for while in not break continue pass def return and or True False None
import from as global del print input open int float str list tuple set dict bool
bin oct hex abs round pow min max sum len range sorted reversed enumerate zip map
any all count replace find rfind index split join strip isdigit upper lower zfill
append pop remove sort reverse copy add keys values items get read readline readlines
itertools product permutations combinations math sqrt ceil log2 fnmatch re findall
string digits ascii_uppercase sys setrecursionlimit turtle tracer left right forward
back up down goto dot screensize done Counter class type id slice eval rsplit clear
reverse=True end maxsize log log10 factorial pi dist sin cos finditer penup pendown
fd bk lt rt speed color pensize begin_fill end_fill update
`

// Сложный уровень: целые строки кода из решений ЕГЭ, по одной на строку.
// Кавычки обычные ('), как их печатают на клавиатуре и в Python.
const EGE_HARD = `
for i in range(n)
for i in range(a, b)
for i in range(a, b, -1)
for i in range(len(s))
for x in s
for i, x in enumerate(s)
for a, b in zip(s, s[1:])
for w in product('АБВ', repeat=5)
for w in permutations('АБВГД')
for w in combinations(s, 2)
for x, y, z, w in product([0, 1], repeat=4)
while n > 0
while n != 0
while True
while '>1' in s or '>2' in s
while '111' in s
if n % 2 == 0
if n % k == 0
if x % 10 == 7
if s.count('A') == 2
if 'A' not in s
if len(set(s)) == len(s)
if s == s[::-1]
if fnmatch(str(x), '12?4*5')
n % 10
n // 10
n % b
n //= b
n % 2
x ** 0.5
int(x ** 0.5) + 1
int(s, 2)
int(s, 16)
bin(n)[2:]
oct(n)[2:]
hex(n)[2:]
s[::-1]
s[1:]
s[:-1]
s.replace('AB', 'C')
s.count('1')
s.split('A')
''.join(w)
' '.join(map(str, a))
list(map(int, input().split()))
map(int, f.readline().split())
[int(x) for x in open('17.txt')]
[x for x in a if x % 2 == 0]
open('24.txt').readline()
open('26.txt').readlines()
with open('27.txt') as f
n = int(f.readline())
a = [int(x) for x in f]
a.sort()
a.sort(reverse=True)
sorted(a, key=lambda x: x[1])
max(a, key=len)
min(a)
sum(a)
len(a)
set()
dict()
d = {}
d[k] = d.get(k, 0) + 1
k = 0
k += 1
m = 0
m = max(m, k)
mx = -10**10
mn = 10**10
float('inf')
print(k)
print(*a)
print(x, y, z, w)
print(len(ans))
print(max(ans), min(ans))
from itertools import *
from itertools import product
from functools import lru_cache
from fnmatch import fnmatch
from math import *
from turtle import *
import sys
sys.setrecursionlimit(10000)
@lru_cache(None)
def f(n):
def f(x, y):
def game(s, m):
return f(n - 1) + n
return 1
return any(...)
return all(...)
(x <= y) == (not z)
not (x or y) <= w
x and not y
(x <= y) and (y == w)
def divs(n):
for d in range(2, int(n ** 0.5) + 1)
if n % d == 0: divs.add(d); divs.add(n // d)
def is_prime(n):
tracer(0)
left(90)
forward(10 * k)
right(60)
up()
down()
goto(x * k, y * k)
dot(3)
screensize(3000, 3000)
done()
for _ in range(7)
s = '8' * 70
s = '>' + '0' * 39 + '1' * 50
ans = []
ans.append(x)
if len(ans) == 5: break
cnt = 0
res = 0
best = 0
prev = a[0]
cur = 1
if cur > best: best = cur
i, j = 0, len(a) - 1
while i < j
`

function parse(text: string) {
  return [...new Set(text.split(/\s+/).filter(Boolean))]
}

// Строки кода делим по переводу строки — пробелы внутри остаются
function parseLines(text: string) {
  return [...new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))]
}

const WORDS: Record<TypingLanguage, string[]> = {
  ru: parse(RU),
  en: parse(EN),
  ege: parse(EGE),
  ege_hard: parseLines(EGE_HARD),
}

// Случайные слова подряд, без повторения одного и того же слова дважды
export function randomWords(language: TypingLanguage, count: number): string[] {
  const list = WORDS[language]
  const result: string[] = []
  while (result.length < count) {
    const word = list[Math.floor(Math.random() * list.length)]
    if (word !== result[result.length - 1]) result.push(word)
  }
  return result
}
