import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styles from './LessonCalendar.module.css'
import type { Assignment } from '../../types'

// Календарь на главной: месяц, дни с занятиями подсвечены. Навели на день — подсказка с уроком,
// нажали — открывается урок (если уроков в день несколько — подсказка со списком закрепляется, выбрать урок в ней).
// Урок стоит в день занятия (lesson_date); у старых уроков без него — в день создания

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

// 'ГГГГ-ММ-ДД' по местному времени
function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function lessonDay(lesson: Assignment) {
  if (lesson.lesson_date) return lesson.lesson_date
  return lesson.created_at ? dayKey(new Date(lesson.created_at)) : null
}

function LessonCalendar({ lessons }: { lessons: Assignment[] }) {
  const navigate = useNavigate()
  const now = new Date()
  const today = dayKey(now)
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const [pinned, setPinned] = useState<string | null>(null) // день с несколькими уроками, где открыт список
  const rootRef = useRef<HTMLElement>(null)

  // Закреплённый список закрывается кликом мимо и по Esc
  useEffect(() => {
    if (!pinned) return
    const onClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(`[data-day="${pinned}"]`)) setPinned(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(null)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  const byDay = new Map<string, Assignment[]>()
  for (const lesson of lessons) {
    const day = lessonDay(lesson)
    if (day) byDay.set(day, [...(byDay.get(day) ?? []), lesson])
  }

  // Клетки месяца: пустые до первого числа (неделя с понедельника), потом дни
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const offset = (first.getDay() + 6) % 7
  const cells: (Date | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ]

  const shift = (delta: number) => {
    setPinned(null)
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1))
  }

  function openDay(key: string, dayLessons: Assignment[]) {
    if (dayLessons.length === 1) navigate(`/assignment/${dayLessons[0].id}`)
    else setPinned(pinned === key ? null : key)
  }

  return (
    <section className={styles.calendar} aria-label="Календарь занятий" ref={rootRef}>
      <div className={styles.header}>
        <button type="button" className={styles.arrow} onClick={() => shift(-1)} aria-label="Предыдущий месяц">
          ‹
        </button>
        <span className={styles.month}>
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </span>
        <button type="button" className={styles.arrow} onClick={() => shift(1)} aria-label="Следующий месяц">
          ›
        </button>
      </div>

      <div className={styles.grid}>
        {WEEKDAYS.map((w) => (
          <span key={w} className={styles.weekday}>
            {w}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`empty-${i}`} />
          const key = dayKey(date)
          const dayLessons = byDay.get(key) ?? []
          const isToday = key === today
          // Подсказка у правых дней недели открывается влево, чтобы не уйти за край
          const column = (offset + date.getDate() - 1) % 7
          if (dayLessons.length === 0) {
            return (
              <span key={key} className={`${styles.day} ${isToday ? styles.today : ''}`}>
                {date.getDate()}
              </span>
            )
          }
          return (
            <span
              key={key}
              data-day={key}
              className={`${styles.dayWrap} ${pinned === key ? styles.pinned : ''} ${column >= 4 ? styles.alignRight : ''}`}
            >
              <button
                type="button"
                className={`${styles.day} ${styles.hasLesson} ${isToday ? styles.today : ''}`}
                onClick={() => openDay(key, dayLessons)}
                aria-label={`${date.getDate()} ${MONTHS_OF[date.getMonth()]}: ${dayLessons.map((l) => l.title).join(', ')}`}
              >
                {date.getDate()}
                {dayLessons.length > 1 && <span className={styles.count}>{dayLessons.length}</span>}
              </button>
              <span className={styles.tooltip} role="tooltip">
                <span className={styles.tooltipDate}>
                  {date.getDate()} {MONTHS_OF[date.getMonth()]}
                </span>
                {dayLessons.map((lesson) => (
                  <Link key={lesson.id} to={`/assignment/${lesson.id}`} className={styles.tooltipLesson}>
                    {lesson.title}
                  </Link>
                ))}
              </span>
            </span>
          )
        })}
      </div>
    </section>
  )
}

export default LessonCalendar
