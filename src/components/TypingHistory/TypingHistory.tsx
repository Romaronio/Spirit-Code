import styles from './TypingHistory.module.css'
import type { TypingLanguage, TypingResult } from '../../types'

interface Props {
  results: TypingResult[] // от новых к старым
  limit?: number
}

const LANGUAGE_LABELS: Record<TypingLanguage, string> = {
  ru: 'рус',
  en: 'eng',
  ege: 'ЕГЭ лёгк.',
  ege_hard: 'ЕГЭ сложн.',
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

// Таблица последних попыток: у ученика — свои, у учителя — выбранного ученика
function TypingHistory({ results, limit = 20 }: Props) {
  if (results.length === 0) {
    return <p className={styles.empty}>Попыток пока нет</p>
  }

  const best = Math.max(...results.map((r) => r.wpm))

  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Когда</th>
            <th>Слов/мин</th>
            <th>Знаков/мин</th>
            <th>Точность</th>
            <th>Тест</th>
          </tr>
        </thead>
        <tbody>
          {results.slice(0, limit).map((r) => (
            <tr key={r.id}>
              <td>{formatDateTime(r.created_at)}</td>
              <td className={styles.wpm}>
                {r.wpm}
                {r.wpm === best && <span className={styles.best} title="Лучший результат"> ★</span>}
              </td>
              <td>{r.cpm}</td>
              <td>{r.accuracy}%</td>
              <td className={styles.muted}>
                {LANGUAGE_LABELS[r.language]}, {r.duration < 60 ? `${r.duration} с` : `${r.duration / 60} мин`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default TypingHistory
