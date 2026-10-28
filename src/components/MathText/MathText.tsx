import styles from './MathText.module.css'
import { parseMath } from '../../utils/math'
import { renderMath, useKatex } from '../../utils/katex'

interface Props {
  text: string
  className?: string
}

// Текст с формулами LaTeX. Пока KaTeX грузится — формулы показываются как есть.
function MathText({ text, className }: Props) {
  const segments = parseMath(text)
  const katex = useKatex(segments.some((s) => s.type === 'math'))

  return (
    <span className={className}>
      {segments.map((s, i) => {
        if (s.type === 'text') return <span key={i}>{s.value}</span>
        if (!katex) {
          return <code key={i} className={styles.raw}>{s.display ? `$$${s.value}$$` : `$${s.value}$`}</code>
        }
        return (
          <span
            key={i}
            className={s.display ? styles.display : styles.inline}
            dangerouslySetInnerHTML={{ __html: renderMath(katex, s.value, s.display) }}
          />
        )
      })}
    </span>
  )
}

export default MathText
