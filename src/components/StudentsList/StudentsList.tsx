import { useState } from 'react'
import { Link } from 'react-router-dom'
import styles from './StudentsList.module.css'
import { normalize } from '../../utils/subjects'
import { formatActivity, studentStats } from '../../utils/studentStats'
import type { Account, Assignment } from '../../types'

interface Props {
  accounts: Account[]
  items: Assignment[]
}

// Учитель: все ученики на главной. Нажатие — профиль ученика со статистикой
function StudentsList({ accounts, items }: Props) {
  const [query, setQuery] = useState('')
  const students = accounts
    .filter((a) => a.role === 'student' && a.id != null)
    .filter((a) => !query.trim() || normalize(a.name).includes(normalize(query)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const total = accounts.filter((a) => a.role === 'student').length

  return (
    <section className={styles.column} aria-label="Ученики">
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>
          Ученики <span className={styles.count}>{total}</span>
        </h2>
        {total > 5 && (
          <input
            className={styles.search}
            type="search"
            placeholder="Найти ученика"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>

      {total === 0 ? (
        <p className={styles.empty}>Учеников пока нет — добавьте их в панели «Ученики»</p>
      ) : students.length === 0 ? (
        <p className={styles.empty}>Никого не нашли</p>
      ) : (
        <ul className={styles.list}>
          {students.map((student) => {
            const stats = studentStats(student, items)
            const percent = stats.total ? Math.round((stats.accepted / stats.total) * 100) : 0
            return (
              <li key={student.id}>
                <Link to={`/student/${student.id}`} className={styles.card}>
                  <span className={styles.avatar} aria-hidden="true">
                    {student.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className={styles.main}>
                    <span className={styles.name}>{student.name}</span>
                    <span className={styles.subjects}>
                      {(student.subjects ?? []).join(', ') || 'предметы не выбраны'}
                    </span>
                    <span className={styles.bar} aria-hidden="true">
                      <span className={styles.barFill} style={{ width: `${percent}%` }} />
                    </span>
                    <span className={styles.meta}>
                      Сдано {stats.accepted} из {stats.total} · {formatActivity(stats.lastActivity)}
                    </span>
                  </span>
                  {stats.pending > 0 && (
                    <span className={styles.pending} title="Ответы ждут проверки">
                      {stats.pending} на проверке
                    </span>
                  )}
                  <span className={styles.arrow} aria-hidden="true">→</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default StudentsList
