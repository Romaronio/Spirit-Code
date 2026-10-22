import { useEffect, useState } from 'react'
import styles from './PaymentsPanel.module.css'
import type { Account } from '../../types'
import * as api from '../../services/api'

interface Props {
  accounts: Account[]
}

// Учебный год: сентябрь — август
const MONTHS = [
  { month: 9, label: 'Сен' },
  { month: 10, label: 'Окт' },
  { month: 11, label: 'Ноя' },
  { month: 12, label: 'Дек' },
  { month: 1, label: 'Янв' },
  { month: 2, label: 'Фев' },
  { month: 3, label: 'Мар' },
  { month: 4, label: 'Апр' },
  { month: 5, label: 'Май' },
  { month: 6, label: 'Июн' },
  { month: 7, label: 'Июл' },
  { month: 8, label: 'Авг' },
]

const FULL_MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

// С сентября начинается новый учебный год
function currentSchoolYear() {
  const now = new Date()
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
}

// Сентябрь–декабрь относятся к первому году, январь–август — ко второму
function yearOf(startYear: number, month: number) {
  return month >= 9 ? startYear : startYear + 1
}

function keyOf(student: number, year: number, month: number) {
  return `${student}-${year}-${month}`
}

function PaymentsPanel({ accounts }: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [startYear, setStartYear] = useState(currentSchoolYear)
  const [paid, setPaid] = useState<Set<string>>(new Set())
  const [loadedYear, setLoadedYear] = useState<number | null>(null)
  const [error, setError] = useState('')

  const students = accounts.filter((a) => a.role === 'student')
  const isLoading = loadedYear !== startYear

  useEffect(() => {
    let cancelled = false
    api
      .getPayments(startYear)
      .then((list) => {
        if (cancelled) return
        setPaid(new Set(list.map((p) => keyOf(p.student, p.year, p.month))))
        setError('')
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить оплату')
      })
      .finally(() => {
        if (!cancelled) setLoadedYear(startYear)
      })
    return () => {
      cancelled = true
    }
  }, [startYear])

  async function toggle(student: number, month: number) {
    const year = yearOf(startYear, month)
    const key = keyOf(student, year, month)
    const nextPaid = !paid.has(key)

    // Сразу меняем отметку на экране, при ошибке — возвращаем как было
    const apply = (value: boolean) =>
      setPaid((prev) => {
        const next = new Set(prev)
        if (value) next.add(key)
        else next.delete(key)
        return next
      })

    apply(nextPaid)
    setError('')
    try {
      await api.setPayment({ student, year, month }, nextPaid)
    } catch (err) {
      apply(!nextPaid)
      setError(err instanceof Error ? err.message : 'Не удалось сохранить отметку')
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h2>Оплата занятий</h2>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
        >
          {isOpen ? 'Свернуть ▲' : 'Развернуть ▼'}
        </button>
      </div>

      {isOpen && (
        <>
          <div className={styles.yearSwitch}>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => setStartYear((y) => y - 1)}
              aria-label="Предыдущий учебный год"
            >
              ‹
            </button>
            <span className={styles.year}>
              {startYear}/{String(startYear + 1).slice(2)}
            </span>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => setStartYear((y) => y + 1)}
              aria-label="Следующий учебный год"
            >
              ›
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          {students.length === 0 ? (
            <p className={styles.empty}>Учеников пока нет</p>
          ) : (
            <div className={`${styles.tableWrap} ${isLoading ? styles.loading : ''}`}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.nameHead}>Ученик</th>
                    {MONTHS.map((m) => (
                      <th key={m.month} scope="col">{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id}>
                      <th scope="row" className={styles.name} title={s.name}>{s.name}</th>
                      {MONTHS.map((m) => {
                        const year = yearOf(startYear, m.month)
                        const isPaid = paid.has(keyOf(s.id!, year, m.month))
                        const label = `${s.name}, ${FULL_MONTHS[m.month - 1]} ${year}: ${isPaid ? 'оплачено' : 'не оплачено'}`
                        return (
                          <td key={m.month}>
                            <button
                              type="button"
                              className={`${styles.cell} ${isPaid ? styles.paid : ''}`}
                              onClick={() => toggle(s.id!, m.month)}
                              disabled={isLoading}
                              aria-pressed={isPaid}
                              aria-label={label}
                              title={label}
                            >
                              {isPaid ? '✓' : ''}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </>
      )}
    </section>
  )
}

export default PaymentsPanel
