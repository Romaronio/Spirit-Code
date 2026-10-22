import { useEffect, useState } from 'react'
import styles from './MathText.module.css'
import { parseMath } from '../../utils/math'

// KaTeX (~300 КБ со шрифтами) грузим только когда на экране есть формула
type Katex = typeof import('katex').default
let katexPromise: Promise<Katex> | null = null

function loadKatex() {
  katexPromise ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
    ([module]) => module.default
  )
  return katexPromise
}

interface Props {
  text: string
  className?: string
}

// Текст с формулами LaTeX. Пока KaTeX грузится — формулы показываются как есть.
function MathText({ text, className }: Props) {
  const segments = parseMath(text)
  const needsKatex = segments.some((s) => s.type === 'math')
  const [katex, setKatex] = useState<Katex | null>(null)

  useEffect(() => {
    if (!needsKatex || katex) return
    let cancelled = false
    loadKatex().then((k) => {
      if (!cancelled) setKatex(() => k)
    })
    return () => {
      cancelled = true
    }
  }, [needsKatex, katex])

  return (
    <span className={className}>
      {segments.map((s, i) => {
        if (s.type === 'text') return <span key={i}>{s.value}</span>
        if (!katex) {
          return <code key={i} className={styles.raw}>{s.display ? `$$${s.value}$$` : `$${s.value}$`}</code>
        }
        // trust: false — никакие команды из формулы не выполняют код и не вставляют ссылки;
        // throwOnError: false — ошибка в формуле показывается красным, а не ломает сообщение
        const html = katex.renderToString(s.value, {
          displayMode: s.display,
          throwOnError: false,
          trust: false,
          strict: 'ignore',
          output: 'htmlAndMathml',
        })
        return (
          <span
            key={i}
            className={s.display ? styles.display : styles.inline}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      })}
    </span>
  )
}

export default MathText
