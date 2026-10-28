// Разбор документа LaTeX с заданиями в простое дерево блоков,
// которое рисует компонент LatexDocument. Это не полноценный TeX:
// понимаем то, что встречается в заданиях (стиль Spirit Code — \zadacha{N}
// и \razdel, плюс обычные списки, формулы, код, таблицы, картинки),
// а незнакомые команды пропускаем, оставляя их текст.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i' | 'u' | 'tt' | 'sc' | 'small' | 'box'; c: Inline[] }
  | { t: 'color'; color: string; c: Inline[] }
  | { t: 'math'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' }

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'task'; title: string }
  | { t: 'hr' }
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'list'; kind: ListKind; start: number; items: Block[][] }
  | { t: 'math'; v: string }
  | { t: 'code'; v: string }
  | { t: 'img'; name: string; width?: string }
  | { t: 'table'; rows: Inline[][][] }
  | { t: 'align'; align: 'center' | 'left' | 'right'; c: Block[] }
  | { t: 'quote'; c: Block[] }
  | { t: 'frame'; c: Block[] }
  | { t: 'figure' } // tikz и прочие рисунки, которые нарисовать нельзя

export type ListKind = 'ul' | '1' | 'a' | 'A' | 'i' | 'I' | 'desc'

// Внутри разбора абзацы собираются из «строчных» кусков; par — граница абзаца
type Item = Inline | Block | { t: 'par' }

const BLOCK_TYPES = new Set(['p', 'task', 'hr', 'h', 'list', 'img', 'table', 'align', 'quote', 'frame', 'figure', 'par'])
// math и code бывают и строчными, и блочными — блочные помечаем отдельно
const blockMath = (v: string): Block => ({ t: 'math', v })
const blockCode = (v: string): Block => ({ t: 'code', v })
const DISPLAY = new WeakSet<object>()

function isBlock(item: Item): item is Block | { t: 'par' } {
  return BLOCK_TYPES.has(item.t) || DISPLAY.has(item)
}

function display<T extends object>(item: T): T {
  DISPLAY.add(item)
  return item
}

// Окружения, содержимое которых берётся как есть (код)
const VERBATIM_ENVS = ['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'BVerbatim', 'comment']
// Окружения формул: отдаём KaTeX целиком
const MATH_ENVS = [
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*',
  'flalign', 'flalign*', 'alignat', 'alignat*', 'eqnarray', 'eqnarray*', 'displaymath', 'math',
]

const SYMBOLS: Record<string, string> = {
  ldots: '…', dots: '…', textellipsis: '…', no: '№', textnumero: '№', S: '§', P: '¶',
  quad: ' ', qquad: '  ', enspace: ' ', thinspace: ' ', space: ' ',
  textbackslash: '\\', textasciitilde: '~', textasciicircum: '^', textbar: '|',
  textless: '<', textgreater: '>', textendash: '–', textemdash: '—', textbullet: '•',
  guillemotleft: '«', guillemotright: '»', flqq: '«', frqq: '»', glqq: '„', grqq: '“',
  copyright: '©', textcopyright: '©', textregistered: '®', texttrademark: '™', textdegree: '°',
  LaTeX: 'LaTeX', TeX: 'TeX', checkmark: '✓', ss: 'ß', i: 'ı', o: 'ø', O: 'Ø',
}

// Команды-обёртки с одним аргументом
const WRAPPERS: Record<string, Inline['t'] | 'plain'> = {
  textbf: 'b', bf: 'b', mathbf: 'b', textit: 'i', emph: 'i', textsl: 'i', it: 'i',
  underline: 'u', uline: 'u', texttt: 'tt', textsc: 'sc', footnotesize: 'small',
  fbox: 'box', framebox: 'box',
  textrm: 'plain', textsf: 'plain', textup: 'plain', textnormal: 'plain', textmd: 'plain',
  mbox: 'plain', hbox: 'plain', makebox: 'plain', text: 'plain', enquote: 'plain', foreignlanguage: 'plain',
}

// Команды, которые ничего не выводят; число — сколько аргументов {…} проглотить
const IGNORED: Record<string, number> = {
  noindent: 0, indent: 0, centering: 0, raggedright: 0, raggedleft: 0, smallskip: 0, medskip: 0,
  bigskip: 0, newpage: 0, clearpage: 0, pagebreak: 0, nopagebreak: 0, maketitle: 0, tableofcontents: 0,
  small: 0, large: 0, Large: 0, LARGE: 0, huge: 0, Huge: 0, normalsize: 0, scriptsize: 0, tiny: 0,
  bfseries: 0, itshape: 0, normalfont: 0, ttfamily: 0, sffamily: 0, rmfamily: 0, upshape: 0, mdseries: 0,
  hfill: 0, vfill: 0, null: 0, relax: 0, protect: 0, selectfont: 0, hline: 0, toprule: 0, midrule: 0,
  bottomrule: 0, nolinebreak: 0, allowbreak: 0, linespread: 1, thispagestyle: 1, pagestyle: 1,
  vspace: 1, 'vspace*': 1, hspace: 1, 'hspace*': 1, needspace: 1, label: 1, setlength: 2, addtolength: 2,
  setcounter: 2, addtocounter: 2, color: 1, fontsize: 2, usepackage: 1, input: 1, include: 1,
  newcommand: 2, renewcommand: 2, cline: 1, vskip: 0, hskip: 0, captionsetup: 1, setlist: 1,
  title: 1, author: 1, date: 1, index: 1, cite: 1, pagenumbering: 1, phantom: 1, hphantom: 1, vphantom: 1,
}

// ---------- предварительная обработка ----------

// Тело документа: всё между \begin{document} и \end{document}, если они есть
export function documentBody(src: string): string {
  const start = src.indexOf('\\begin{document}')
  if (start === -1) return src
  const from = start + '\\begin{document}'.length
  const end = src.indexOf('\\end{document}', from)
  return src.slice(from, end === -1 ? undefined : end)
}

// Убирает комментарии %…, не трогая \% и содержимое окружений с кодом
// (в коде на Python знак % — это остаток от деления)
export function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') {
      const verb = matchVerbatimStart(src, i)
      if (verb) {
        const endTag = `\\end{${verb}}`
        const end = src.indexOf(endTag, i)
        const stop = end === -1 ? src.length : end + endTag.length
        out += src.slice(i, stop)
        i = stop
        continue
      }
      const inline = src.slice(i).match(/^\\verb\*?([^a-zA-Z\s*])/)
      if (inline) {
        const end = src.indexOf(inline[1], i + inline[0].length)
        const stop = end === -1 ? src.length : end + 1
        out += src.slice(i, stop)
        i = stop
        continue
      }
      out += src.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === '%') {
      // Комментарий съедает и перевод строки, и пробелы в начале следующей
      const nl = src.indexOf('\n', i)
      if (nl === -1) break
      i = nl + 1
      while (src[i] === ' ' || src[i] === '\t') i++
      continue
    }
    out += ch
    i++
  }
  return out
}

function matchVerbatimStart(src: string, i: number): string | null {
  if (!src.startsWith('\\begin{', i)) return null
  const close = src.indexOf('}', i)
  const name = src.slice(i + 7, close)
  return VERBATIM_ENVS.includes(name) ? name : null
}

// ---------- чтение аргументов ----------

// Группа {…} начиная с позиции открывающей скобки → [содержимое, позиция после }]
function readGroup(src: string, pos: number): [string, number] {
  let depth = 0
  for (let i = pos; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return [src.slice(pos + 1, i), i + 1]
    }
  }
  return [src.slice(pos + 1), src.length]
}

// Необязательный аргумент […], если он есть (пробелы перед ним допускаются)
function readOptional(src: string, pos: number): [string | null, number] {
  let i = pos
  while (src[i] === ' ' || src[i] === '\t') i++
  if (src[i] !== '[') return [null, pos]
  let depth = 0
  for (let j = i; j < src.length; j++) {
    const ch = src[j]
    if (ch === '\\') {
      j++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === ']' && depth === 0) return [src.slice(i + 1, j), j + 1]
  }
  return [null, pos]
}

// Обязательный аргумент: {…} или одна лексема без скобок (\textbf x)
function readArg(src: string, pos: number): [string, number] {
  let i = pos
  while (src[i] === ' ' || src[i] === '\t' || src[i] === '\n') i++
  if (src[i] === '{') return readGroup(src, i)
  if (src[i] === '\\') {
    const m = src.slice(i).match(/^\\([a-zA-Z]+|.)/)
    if (m) return [m[0], i + m[0].length]
  }
  if (i >= src.length) return ['', i]
  return [src[i], i + 1]
}

function skipArgs(src: string, pos: number, count: number): number {
  let i = readOptional(src, pos)[1]
  for (let k = 0; k < count; k++) {
    i = readArg(src, i)[1]
    i = readOptional(src, i)[1]
  }
  return i
}

// Конец окружения name с учётом вложенных окружений того же имени
function findEnd(src: string, name: string, pos: number): [string, number] {
  const begin = `\\begin{${name}}`
  const end = `\\end{${name}}`
  if (VERBATIM_ENVS.includes(name)) {
    const at = src.indexOf(end, pos)
    return at === -1 ? [src.slice(pos), src.length] : [src.slice(pos, at), at + end.length]
  }
  let depth = 1
  let i = pos
  while (i < src.length) {
    const nextBegin = src.indexOf(begin, i)
    const nextEnd = src.indexOf(end, i)
    if (nextEnd === -1) return [src.slice(pos), src.length]
    if (nextBegin !== -1 && nextBegin < nextEnd) {
      depth++
      i = nextBegin + begin.length
    } else {
      depth--
      if (depth === 0) return [src.slice(pos, nextEnd), nextEnd + end.length]
      i = nextEnd + end.length
    }
  }
  return [src.slice(pos), src.length]
}

// Делит текст по разделителю, стоящему на верхнем уровне
// (не внутри {…}, вложенных окружений и формул)
function splitTopLevel(src: string, sep: RegExp): string[] {
  const parts: string[] = []
  let depth = 0
  let envDepth = 0
  let inMath = false
  let last = 0
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') {
      if (src.startsWith('\\begin{', i)) {
        const name = src.slice(i + 7, src.indexOf('}', i))
        if (VERBATIM_ENVS.includes(name)) {
          i = findEnd(src, name, src.indexOf('}', i) + 1)[1]
          continue
        }
        envDepth++
      } else if (src.startsWith('\\end{', i)) envDepth--
      if (depth === 0 && envDepth === 0 && !inMath) {
        const m = src.slice(i).match(sep)
        if (m && m.index === 0) {
          parts.push(src.slice(last, i))
          i += m[0].length
          last = i
          continue
        }
      }
      i += 2
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '$') inMath = !inMath
    else if (depth === 0 && envDepth === 0 && !inMath) {
      const m = src.slice(i).match(sep)
      if (m && m.index === 0) {
        parts.push(src.slice(last, i))
        i += m[0].length
        last = i
        continue
      }
    }
    i++
  }
  parts.push(src.slice(last))
  return parts
}

// ---------- текст ----------

// Типографские лигатуры TeX и спецсимволы обычного текста
function plainText(s: string): string {
  return s
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/<</g, '«')
    .replace(/>>/g, '»')
    .replace(/,,/g, '„')
    .replace(/``/g, '“')
    .replace(/''/g, '”')
    .replace(/~/g, ' ')
}

// ---------- основной разбор ----------

function parseItems(src: string): Item[] {
  const items: Item[] = []
  let text = ''

  const flush = () => {
    if (text) items.push({ t: 'text', v: plainText(text) })
    text = ''
  }
  const push = (item: Item) => {
    flush()
    items.push(item)
  }

  let i = 0
  while (i < src.length) {
    const ch = src[i]

    // Пустая строка — новый абзац
    if (ch === '\n') {
      let j = i + 1
      while (src[j] === ' ' || src[j] === '\t' || src[j] === '\r') j++
      if (src[j] === '\n') {
        while (src[j] === '\n' || src[j] === ' ' || src[j] === '\t' || src[j] === '\r') j++
        push({ t: 'par' })
        i = j
        continue
      }
      text += ' '
      i++
      continue
    }

    if (ch === '$') {
      if (src[i + 1] === '$') {
        const end = src.indexOf('$$', i + 2)
        const stop = end === -1 ? src.length : end
        push(display(blockMath(src.slice(i + 2, stop).trim())))
        i = stop + 2
        continue
      }
      const end = findClosingDollar(src, i + 1)
      push({ t: 'math', v: src.slice(i + 1, end).trim() })
      i = end + 1
      continue
    }

    if (ch === '{' ) {
      const [inner, next] = readGroup(src, i)
      flush()
      items.push(...parseItems(inner))
      i = next
      continue
    }
    if (ch === '}') {
      i++
      continue
    }
    if (ch === '&') {
      text += ' '
      i++
      continue
    }

    if (ch !== '\\') {
      text += ch === '\t' || ch === '\r' ? ' ' : ch
      i++
      continue
    }

    // --- команды ---
    const next = src[i + 1]
    if (next === undefined) break

    // Экранированные символы и короткие команды
    if ('%&#_{}$'.includes(next)) {
      text += next
      i += 2
      continue
    }
    if (next === '\\') {
      push({ t: 'br' })
      i = readOptional(src, i + 2)[1]
      continue
    }
    if (next === ',' || next === ' ' || next === ';' || next === ':') {
      text += next === ',' ? ' ' : ' '
      i += 2
      continue
    }
    if (next === '-' || next === '/' || next === '!') {
      i += 2
      continue
    }
    if (next === '(') {
      const end = src.indexOf('\\)', i + 2)
      const stop = end === -1 ? src.length : end
      push({ t: 'math', v: src.slice(i + 2, stop).trim() })
      i = stop + 2
      continue
    }
    if (next === '[') {
      const end = src.indexOf('\\]', i + 2)
      const stop = end === -1 ? src.length : end
      push(display(blockMath(src.slice(i + 2, stop).trim())))
      i = stop + 2
      continue
    }

    const m = src.slice(i).match(/^\\([a-zA-Z]+\*?)/)
    if (!m) {
      // Акценты вроде \" \' \^ — просто убираем команду
      i += 2
      continue
    }
    const name = m[1]
    let pos = i + m[0].length
    // Пробелы после командного слова TeX съедает
    const eatSpace = () => {
      while (src[pos] === ' ' || src[pos] === '\t') pos++
    }

    if (name === 'verb' || name === 'verb*') {
      const delim = src[pos]
      const end = src.indexOf(delim, pos + 1)
      const stop = end === -1 ? src.length : end
      push({ t: 'code', v: src.slice(pos + 1, stop) })
      i = stop + 1
      continue
    }

    if (name === 'begin') {
      const [env, after] = readGroup(src, pos)
      const [body, endPos] = findEnd(src, env, after)
      const item = parseEnvironment(env, body)
      if (item) {
        if (Array.isArray(item)) {
          flush()
          items.push(...item)
        } else push(item)
      }
      i = endPos
      continue
    }
    if (name === 'end') {
      i = readGroup(src, pos)[1]
      continue
    }

    if (name === 'zadacha') {
      const [arg, after] = readArg(src, pos)
      push({ t: 'task', title: `Задача ${textOf(arg)}` })
      i = after
      continue
    }
    if (name === 'razdel' || name === 'hrule' || name === 'rule' || name === 'hrulefill') {
      push({ t: 'hr' })
      i = name === 'rule' ? skipArgs(src, pos, 2) : pos
      continue
    }
    if (name === 'par') {
      push({ t: 'par' })
      i = pos
      continue
    }
    if (name === 'newline' || name === 'linebreak') {
      push({ t: 'br' })
      i = readOptional(src, pos)[1]
      continue
    }

    const heading = HEADINGS[name.replace('*', '')]
    if (heading) {
      pos = readOptional(src, pos)[1]
      const [arg, after] = readArg(src, pos)
      push({ t: 'h', level: heading, c: parseInlines(arg) })
      i = after
      continue
    }

    if (name === 'includegraphics' || name === 'includegraphics*') {
      const [opts, afterOpts] = readOptional(src, pos)
      const [file, after] = readArg(src, afterOpts)
      push({ t: 'img', name: file.trim(), width: imageWidth(opts) })
      i = after
      continue
    }

    if (name === 'textcolor' || name === 'colorbox') {
      pos = readOptional(src, pos)[1]
      const [color, afterColor] = readArg(src, pos)
      const [arg, after] = readArg(src, afterColor)
      const content = parseInlines(arg)
      push(name === 'colorbox' ? { t: 'box', c: content } : { t: 'color', color: color.trim(), c: content })
      i = after
      continue
    }

    if (name === 'href') {
      const [url, afterUrl] = readArg(src, pos)
      const [arg, after] = readArg(src, afterUrl)
      push({ t: 'link', href: url.trim(), c: parseInlines(arg) })
      i = after
      continue
    }
    if (name === 'url') {
      const [url, after] = readArg(src, pos)
      push({ t: 'link', href: url.trim(), c: [{ t: 'text', v: url.trim() }] })
      i = after
      continue
    }

    if (name === 'footnote') {
      const [arg, after] = readArg(src, pos)
      push({ t: 'small', c: [{ t: 'text', v: ' (' }, ...parseInlines(arg), { t: 'text', v: ')' }] })
      i = after
      continue
    }
    if (name === 'caption') {
      pos = readOptional(src, pos)[1]
      const [arg, after] = readArg(src, pos)
      push({ t: 'p', c: [{ t: 'i', c: parseInlines(arg) }] })
      i = after
      continue
    }
    if (name === 'item') {
      // \item вне списка — считаем пунктом без маркера
      const [label, after] = readOptional(src, pos)
      push({ t: 'par' })
      if (label) push({ t: 'b', c: parseInlines(label + ' ') })
      i = after
      continue
    }
    if (name === 'today') {
      text += new Date().toLocaleDateString('ru-RU')
      i = pos
      continue
    }

    const wrapper = WRAPPERS[name]
    if (wrapper) {
      // \makebox[ширина]{…}, \foreignlanguage{english}{…}
      pos = readOptional(src, pos)[1]
      if (name === 'foreignlanguage') pos = readArg(src, pos)[1]
      pos = readOptional(src, pos)[1]
      const [arg, after] = readArg(src, pos)
      const content = parseInlines(arg)
      if (wrapper === 'plain') {
        flush()
        items.push(...content)
      } else if (name === 'enquote') {
        push({ t: 'text', v: '«' })
        items.push(...content, { t: 'text', v: '»' })
      } else {
        push({ t: wrapper, c: content } as Inline)
      }
      i = after
      continue
    }

    if (name in SYMBOLS) {
      text += SYMBOLS[name]
      i = pos
      if (/^[a-zA-Z]/.test(name)) eatSpace()
      if (src.startsWith('{}', i)) i += 2
      continue
    }

    if (name in IGNORED) {
      i = skipArgs(src, pos, IGNORED[name])
      eatSpace()
      continue
    }

    // Незнакомая команда: само слово выбрасываем, текст в {…} после неё оставляем
    i = readOptional(src, pos)[1]
    eatSpace()
  }
  flush()
  return items
}

const HEADINGS: Record<string, 1 | 2 | 3> = {
  part: 1, chapter: 1, section: 1, subsection: 2, subsubsection: 3, paragraph: 3, subparagraph: 3,
}

// Закрывающий $ строчной формулы (\$ внутри формулы не закрывает её)
function findClosingDollar(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') {
      i++
      continue
    }
    if (src[i] === '$') return i
  }
  return src.length
}

// Ширина картинки из опций: width=0.5\textwidth → 50%, width=5cm → 5cm
function imageWidth(opts: string | null): string | undefined {
  if (!opts) return undefined
  const m = opts.match(/(?:^|,)\s*width\s*=\s*([\d.]*)\s*\\(?:text|line|column)width/)
  if (m) return `${Math.min(100, Math.round(parseFloat(m[1] || '1') * 100))}%`
  const abs = opts.match(/(?:^|,)\s*width\s*=\s*([\d.]+)\s*(cm|mm|pt|in|em)/)
  if (abs) return `${abs[1]}${abs[2]}`
  const scale = opts.match(/(?:^|,)\s*scale\s*=\s*([\d.]+)/)
  if (scale) return `${Math.min(100, Math.round(parseFloat(scale[1]) * 100))}%`
  return undefined
}

function parseEnvironment(env: string, body: string): Item | Item[] | null {
  const name = env.trim()
  if (name === 'document') return parseItems(body)

  if (VERBATIM_ENVS.includes(name)) {
    if (name === 'comment') return null
    // \begin{lstlisting}[language=Python] и \begin{minted}{python}: опции пропускаем
    let code = body
    const opt = code.match(/^\s*\[[^\]\n]*\]/)
    if (opt) code = code.slice(opt[0].length)
    if (name === 'minted') code = code.replace(/^\s*\{[^}\n]*\}/, '')
    return display(blockCode(code.replace(/^[ \t]*\n/, '').replace(/\s+$/, '')))
  }

  if (MATH_ENVS.includes(name)) {
    const kind = name.startsWith('eqnarray') ? 'align*' : name
    if (kind === 'displaymath' || kind === 'math') return display(blockMath(body.trim()))
    return display(blockMath(`\\begin{${kind}}${body}\\end{${kind}}`))
  }

  if (name === 'itemize' || name === 'enumerate' || name === 'description') {
    return parseList(name, body)
  }

  if (name === 'center' || name === 'flushleft' || name === 'flushright') {
    const align = name === 'center' ? 'center' : name === 'flushleft' ? 'left' : 'right'
    return { t: 'align', align, c: parseBlocks(body) }
  }

  if (name === 'quote' || name === 'quotation' || name === 'verse') {
    return { t: 'quote', c: parseBlocks(body) }
  }

  if (/^(tabular\*?|tabularx|tabulary|longtable|array)$/.test(name)) {
    return parseTable(name, body)
  }

  if (name === 'tikzpicture' || name === 'pspicture' || name === 'picture') {
    return { t: 'figure' }
  }

  if (/^(tcolorbox|mdframed|framed|shaded|boxed)$/.test(name)) {
    const inner = body.replace(/^\s*\[[^\]]*\]/, '')
    return { t: 'frame', c: parseBlocks(inner) }
  }

  if (name === 'minipage') {
    // \begin{minipage}[t]{0.5\textwidth}
    let pos = readOptional(body, 0)[1]
    pos = readArg(body, pos)[1]
    return parseItems(body.slice(pos))
  }

  if (name === 'figure' || name === 'figure*' || name === 'table' || name === 'table*' || name === 'wrapfigure') {
    let inner = body.replace(/^\s*\[[^\]]*\]/, '')
    if (name === 'wrapfigure') inner = inner.replace(/^\s*\{[^}]*\}\s*\{[^}]*\}/, '')
    return { t: 'align', align: 'center', c: parseBlocks(inner) }
  }

  // Незнакомое окружение: его аргументы пропустить нельзя (их число неизвестно),
  // поэтому просто показываем содержимое
  return parseItems(body)
}

function parseList(name: string, body: string): Block {
  const [opts, afterOpts] = readOptional(body, 0)
  let kind: ListKind = name === 'itemize' ? 'ul' : name === 'description' ? 'desc' : '1'
  let start = 1
  if (name === 'enumerate' && opts) {
    if (/\\alph/.test(opts)) kind = 'a'
    else if (/\\Alph/.test(opts)) kind = 'A'
    else if (/\\roman/.test(opts)) kind = 'i'
    else if (/\\Roman/.test(opts)) kind = 'I'
    const s = opts.match(/start\s*=\s*(\d+)/)
    if (s) start = Number(s[1])
  }
  const parts = splitTopLevel(body.slice(afterOpts), /^\\item(?![a-zA-Z])/)
  const items = parts.slice(1).map((part) => {
    const [label, after] = readOptional(part, 0)
    const blocks = parseBlocks(part.slice(after))
    if (label !== null) {
      // \item[б)] или пункт description: метка жирным в начале
      const labelInline: Inline = { t: 'b', c: parseInlines(label) }
      const first = blocks[0]
      if (first && first.t === 'p') first.c.unshift(labelInline, { t: 'text', v: ' ' })
      else blocks.unshift({ t: 'p', c: [labelInline] })
    }
    return blocks
  })
  // Пункты с собственными метками рисуем без автоматических номеров
  const allLabeled = parts.slice(1).length > 0 && parts.slice(1).every((p) => readOptional(p, 0)[0] !== null)
  return { t: 'list', kind: allLabeled ? 'desc' : kind, start, items }
}

function parseTable(name: string, body: string): Block {
  let pos = 0
  if (name === 'tabular*' || name === 'tabularx' || name === 'tabulary') pos = readArg(body, pos)[1] // ширина
  pos = readOptional(body, pos)[1]
  if (name !== 'longtable' || body.trimStart().startsWith('{')) pos = readArg(body, pos)[1] // колонки
  const rows = splitTopLevel(body.slice(pos), /^\\\\(\[[^\]]*\])?/)
    .map((row) => row.replace(/\\(hline|toprule|midrule|bottomrule|endhead|endfirsthead)(?![a-zA-Z])/g, '').replace(/\\cline\{[^}]*\}/g, ''))
    .filter((row) => row.trim() !== '')
    .map((row) => splitTopLevel(row, /^&/).map((cell) => parseInlines(cell.replace(/\\multicolumn\{\d+\}\{[^}]*\}/g, ''))))
  return { t: 'table', rows }
}

// Текст аргумента без разметки (для номера задачи)
function textOf(src: string): string {
  return inlineText(parseInlines(src)).trim()
}

function inlineText(items: Inline[]): string {
  return items.map((it) => ('v' in it ? it.v : 'c' in it ? inlineText(it.c) : ' ')).join('')
}

// Только строчное содержимое (для аргументов \textbf{…} и т.п.)
export function parseInlines(src: string): Inline[] {
  const result: Inline[] = []
  for (const item of parseItems(src)) {
    if (!isBlock(item)) result.push(item as Inline)
    else if (item.t === 'math') result.push({ t: 'math', v: item.v })
    else if (item.t === 'code') result.push({ t: 'code', v: item.v })
    else if (item.t === 'p') result.push(...item.c)
    else result.push({ t: 'text', v: ' ' })
  }
  return result
}

// Собирает строчные куски в абзацы
function parseBlocks(src: string): Block[] {
  const blocks: Block[] = []
  let para: Inline[] = []

  const flush = () => {
    // Пробелы и переносы по краям абзаца не нужны
    while (para.length && isBlank(para[0])) para.shift()
    while (para.length && isBlank(para[para.length - 1])) para.pop()
    if (para.length) {
      const c = mergeText(para)
      const first = c[0]
      const last = c[c.length - 1]
      if (first.t === 'text') first.v = first.v.trimStart()
      if (last.t === 'text') last.v = last.v.trimEnd()
      blocks.push({ t: 'p', c })
    }
    para = []
  }

  for (const item of parseItems(src)) {
    if (!isBlock(item)) {
      para.push(item as Inline)
      continue
    }
    flush()
    if (item.t !== 'par') blocks.push(item as Block)
  }
  flush()
  return blocks
}

function isBlank(item: Inline) {
  return item.t === 'br' || (item.t === 'text' && item.v.trim() === '')
}

// Склеивает соседние куски текста и схлопывает повторные пробелы
function mergeText(items: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const item of items) {
    const prev = out[out.length - 1]
    if (item.t === 'text' && prev?.t === 'text') prev.v += item.v
    else out.push(item.t === 'text' ? { ...item } : item)
  }
  for (const item of out) {
    if (item.t === 'text') item.v = item.v.replace(/[ \t]+/g, ' ')
  }
  return out
}

export interface LatexDoc {
  blocks: Block[]
  tasks: number // сколько заданий \zadacha
  images: string[] // имена картинок из \includegraphics
}

export function parseLatex(src: string): LatexDoc {
  const blocks = parseBlocks(stripComments(documentBody(src.replace(/\r\n?/g, '\n'))))
  const images: string[] = []
  let tasks = 0
  const walk = (list: Block[]) => {
    for (const b of list) {
      if (b.t === 'task') tasks++
      else if (b.t === 'img') images.push(b.name)
      else if (b.t === 'list') b.items.forEach(walk)
      else if (b.t === 'align' || b.t === 'quote' || b.t === 'frame') walk(b.c)
    }
  }
  walk(blocks)
  return { blocks, tasks, images }
}

// Имя файла без папок и расширения, в нижнем регистре: «img/Graph.PNG» → «graph»
export function imageKey(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  return base.replace(/\.[a-zA-Z0-9]+$/, '').trim().toLowerCase()
}
