import { Fragment, useEffect, useState } from 'react'
import styles from './TypingResultsPanel.module.css'
import type { TypingLanguage, TypingModeSummary, TypingSummary } from '../../types'
import * as api from '../../services/api'

type SortKey = 'student_name' | 'best_wpm' | 'last_wpm' | 'avg_wpm' | 'avg_accuracy' | 'tests'

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'student_name', label: 'Ученик' },
  { key: 'best_wpm', label: 'Лучший', title: 'Лучший результат, слов в минуту' },
  { key: 'last_wpm', label: 'Последний', title: 'Последний результат, слов в минуту' },
  { key: 'avg_wpm', label: 'Средний', title: 'Средняя скорость за последние 10 попыток' },
  { key: 'avg_accuracy', label: 'Точность', title: 'Средняя точность за последние 10 попыток' },
  { key: 'tests', label: 'Попыток' },
]

const MODE_LABELS: Record<TypingLanguage, string> = {
  ru: 'Русский',
  en: 'English',
  ege: 'ЕГЭ лёгкий',
  ege_hard: 'ЕГЭ сложный',
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

function show(value: number | null, suffix = '') {
  return value === null ? '—' : `${value}${suffix}`
}

// Учитель: сводка скорости печати по всем ученикам, клик по строке — история ученика
function TypingResultsPanel() {
  const [rows, setRows] = useState<TypingSummary[]>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [sort, setSort] = useState<SortKey>('best_wpm')
  const [openStudent, setOpenStudent] = useState<number | null>(null)
  const [modes, setModes] = useState<{ student: number; list: TypingModeSummary[] } | null>(null)

  // reload меняется по кнопке «Обновить» и заново запускает загрузку
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let cancelled = false
    api
      .getTypingSummary()
      .then((list) => {
        if (cancelled) return
        setRows(list)
        setError('')
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить результаты')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reload])

  function refresh() {
    setIsLoading(true)
    setReload((n) => n + 1)
  }

  // Статистика по режимам подгружается при раскрытии строки. Ответ запоминаем
  // вместе с учеником: если учитель успел раскрыть другого, чужие цифры не покажутся.
  async function toggleStudent(studentId: number) {
    if (openStudent === studentId) {
      setOpenStudent(null)
      return
    }
    setOpenStudent(studentId)
    let list: TypingModeSummary[] = []
    try {
      list = await api.getTypingByMode(studentId)
    } catch {
      /* покажем пустую таблицу */
    }
    setModes({ student: studentId, list })
  }

  // Имя — по алфавиту, числа — от большего к меньшему; кто не проходил тест — в конце
  const sorted = [...rows].sort((a, b) => {
    if (sort === 'student_name') return a.student_name.localeCompare(b.student_name, 'ru')
    return (b[sort] ?? -1) - (a[sort] ?? -1)
  })

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <h2>Скорость печати учеников</h2>
        <button type="button" className={styles.refresh} onClick={refresh} disabled={isLoading}>
          ↻ Обновить
        </button>
      </div>
      <p className={styles.hint}>Скорость — в словах в минуту. Нажмите на ученика, чтобы увидеть его результаты по каждому режиму.</p>

      {error && <p className={styles.error}>{error}</p>}

      {!isLoading && rows.length === 0 ? (
        <p className={styles.hint}>Учеников пока нет</p>
      ) : (
        <div className={`${styles.wrap} ${isLoading ? styles.loading : ''}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} title={col.title} aria-sort={sort === col.key ? 'descending' : undefined}>
                    <button type="button" className={styles.sortButton} onClick={() => setSort(col.key)}>
                      {col.label}
                      {sort === col.key && ' ▾'}
                    </button>
                  </th>
                ))}
                <th>Когда</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const isOpen = openStudent === row.student
                return (
                  <Fragment key={row.student}>
                    <tr
                      className={`${styles.row} ${isOpen ? styles.open : ''}`}
                      onClick={() => toggleStudent(row.student)}
                      aria-expanded={isOpen}
                    >
                      <td className={styles.name}>{row.student_name}</td>
                      <td className={styles.strong}>{show(row.best_wpm)}</td>
                      <td>{show(row.last_wpm)}</td>
                      <td>{show(row.avg_wpm)}</td>
                      <td>{show(row.avg_accuracy, '%')}</td>
                      <td>{row.tests}</td>
                      <td className={styles.muted}>{row.last_at ? formatDateTime(row.last_at) : '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={COLUMNS.length + 1} className={styles.historyCell}>
                          {modes?.student === row.student ? (
                            <table className={styles.modesTable}>
                              <thead>
                                <tr>
                                  <th>Режим</th>
                                  <th>Лучший</th>
                                  <th>Последний</th>
                                  <th>Средний</th>
                                  <th>Точность</th>
                                  <th>Попыток</th>
                                  <th>Когда</th>
                                </tr>
                              </thead>
                              <tbody>
                                {modes.list.map((m) => (
                                  <tr key={m.language} className={m.tests === 0 ? styles.noTests : ''}>
                                    <td className={styles.name}>{MODE_LABELS[m.language]}</td>
                                    <td className={styles.strong}>{show(m.best_wpm)}</td>
                                    <td>{show(m.last_wpm)}</td>
                                    <td>{show(m.avg_wpm)}</td>
                                    <td>{show(m.avg_accuracy, '%')}</td>
                                    <td>{m.tests}</td>
                                    <td className={styles.muted}>{m.last_at ? formatDateTime(m.last_at) : '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className={styles.hint}>Загрузка...</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default TypingResultsPanel
