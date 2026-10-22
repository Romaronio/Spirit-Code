// Разбор текста с формулами LaTeX (рисует их компонент MathText)

export type Segment =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; display: boolean }

// Разбивает текст на обычные куски и формулы:
//   $$...$$ — формула отдельной строкой
//   $...$   — формула в строке. Как в Pandoc: после открывающего $ и перед
//             закрывающим не должно быть пробела, а после закрывающего — цифры.
//             Поэтому «стоит 500$ и 300$» остаётся текстом.
//   \$      — просто знак доллара
const MATH_RE = /\\\$|\$\$([\s\S]+?)\$\$|\$(?=\S)((?:\\\$|[^$\n])*?\S)\$(?!\d)/g

export function parseMath(text: string): Segment[] {
  const segments: Segment[] = []
  let buffer = ''
  let last = 0
  for (const match of text.matchAll(MATH_RE)) {
    buffer += text.slice(last, match.index)
    last = match.index + match[0].length
    if (match[0] === '\\$') {
      buffer += '$'
      continue
    }
    if (buffer) segments.push({ type: 'text', value: buffer })
    buffer = ''
    const display = match[1] !== undefined
    segments.push({ type: 'math', value: (display ? match[1] : match[2]).trim(), display })
  }
  buffer += text.slice(last)
  if (buffer) segments.push({ type: 'text', value: buffer })
  return segments
}

export function hasMath(text: string) {
  return parseMath(text).some((s) => s.type === 'math')
}
