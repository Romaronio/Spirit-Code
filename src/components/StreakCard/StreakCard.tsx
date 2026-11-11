import { useEffect, useState } from 'react'
import styles from './StreakCard.module.css'
import { getStreak, type Streak } from '../../services/api'

// Серия дней под приветствием ученика: сколько дней подряд он что-то решал, рекорд и последние 7 дней.
// Активность — ответ к заданию, отправка ДЗ, сообщение учителю, тренажёр печати, ответ в созвоне

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

// refreshKey меняется, когда данные на сайте обновились, — серия перечитывается
function StreakCard({ refreshKey }: { refreshKey?: unknown }) {
  const [streak, setStreak] = useState<Streak | null>(null)

  useEffect(() => {
    let cancelled = false
    getStreak()
      .then((data) => !cancelled && setStreak(data))
      .catch(() => {}) // без серии главная просто без этого блока
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (!streak) return null

  const { current, best, active_today: activeToday } = streak
  const hint = activeToday
    ? 'Сегодня вы уже занимались — серия продолжается'
    : current > 0
      ? 'Решите что-нибудь сегодня, чтобы не прервать серию'
      : 'Начните серию: ответьте на задание или потренируйтесь в печати'

  return (
    <div className={styles.card}>
      <div className={styles.main}>
        <span className={`${styles.flame} ${current === 0 ? styles.off : ''}`} aria-hidden="true">
          🔥
        </span>
        <div className={styles.text}>
          <span className={styles.value}>
            {current} {plural(current, 'день', 'дня', 'дней')} подряд
          </span>
          <span className={styles.hint}>{hint}</span>
        </div>
        {best > 0 && (
          <span className={styles.best}>
            Рекорд: {best} {plural(best, 'день', 'дня', 'дней')}
          </span>
        )}
      </div>
      <ol className={styles.week} aria-label="Последние 7 дней">
        {streak.week.map((d, i) => {
          const isToday = i === streak.week.length - 1
          const weekday = WEEKDAYS[new Date(`${d.date}T12:00:00`).getDay()]
          return (
            <li key={d.date} className={styles.day}>
              <span
                className={`${styles.dot} ${d.active ? styles.active : ''} ${isToday ? styles.today : ''}`}
                title={d.active ? 'Занимались' : 'Не занимались'}
              >
                {d.active ? '✓' : ''}
              </span>
              <span className={styles.weekday}>{isToday ? 'Сегодня' : weekday}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default StreakCard
