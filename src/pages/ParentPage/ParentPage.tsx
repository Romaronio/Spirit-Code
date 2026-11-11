import { useEffect, useState } from 'react'
import styles from './ParentPage.module.css'
import { getParentStats, type ParentHomework, type ParentStats } from '../../services/api'

const REVIEW_LABELS = {
  accepted: 'Сдано',
  rejected: 'Нужно исправить',
} as const

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function tone(percent: number) {
  if (percent >= 100) return styles.full
  if (percent >= 50) return styles.half
  return styles.low
}

// Страница для родителей ученика по секретной ссылке /parent/<token>: все домашки и процент выполнения.
// Открывается без входа, ничего не меняет
function ParentPage({ token }: { token: string }) {
  const [data, setData] = useState<ParentStats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = 'Успеваемость · Spirit Code'
    let cancelled = false
    getParentStats(token)
      .then((stats) => !cancelled && setData(stats))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Не удалось загрузить данные'))
    return () => {
      cancelled = true
    }
  }, [token])

  if (error) {
    return (
      <main className={styles.page}>
        <p className={styles.brand}>Spirit Code</p>
        <p className={styles.error}>{error}</p>
      </main>
    )
  }
  if (!data) {
    return (
      <main className={styles.page}>
        <p className={styles.muted}>Загрузка…</p>
      </main>
    )
  }

  const rows = data.homeworks
  const complete = rows.filter((r) => r.percent >= 100).length

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.brand}>Spirit Code · успеваемость</p>
        <h1 className={styles.name}>{data.student}</h1>
      </header>

      {rows.length === 0 ? (
        <p className={styles.muted}>Домашних заданий пока не было</p>
      ) : (
        <>
          <section className={styles.tiles} aria-label="Итого">
            <div className={styles.tile}>
              <span className={`${styles.tileValue} ${tone(data.average ?? 0)}`}>{data.average}%</span>
              <span className={styles.tileLabel}>в среднем выполнено</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileValue}>
                {complete} из {rows.length}
              </span>
              <span className={styles.tileLabel}>домашек выполнено полностью</span>
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Домашние задания · {rows.length}</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Урок</th>
                    <th>Срок</th>
                    <th>Выполнено</th>
                    <th>Отметка учителя</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Row key={r.id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.note}>
              Выполнено — к скольким заданиям домашки ученик прислал ответ. Верность ответов проверяет учитель.
            </p>
          </section>
        </>
      )}
    </main>
  )
}

function Row({ row }: { row: ParentHomework }) {
  return (
    <tr>
      <td>
        <span className={styles.lessonTitle}>{row.title}</span>
        <span className={styles.subject}>{row.subject}</span>
      </td>
      <td className={styles.nowrap}>{row.has_deadline ? formatDate(row.date) : '—'}</td>
      <td>
        <div className={styles.progress}>
          <span className={`${styles.percent} ${tone(row.percent)}`}>{row.percent}%</span>
          <span
            className={styles.bar}
            role="progressbar"
            aria-valuenow={row.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className={`${styles.fill} ${tone(row.percent)}`} style={{ width: `${row.percent}%` }} />
          </span>
          <span className={styles.count}>
            {row.done} из {row.total}
          </span>
        </div>
      </td>
      <td className={styles.nowrap}>
        {row.review ? (
          <span className={row.review === 'accepted' ? styles.accepted : styles.rejected}>{REVIEW_LABELS[row.review]}</span>
        ) : (
          <span className={styles.muted}>не проверено</span>
        )}
      </td>
    </tr>
  )
}

export default ParentPage
