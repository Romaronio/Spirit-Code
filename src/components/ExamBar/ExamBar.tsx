import { useEffect, useRef, useState } from 'react'
import styles from './ExamBar.module.css'
import * as api from '../../services/api'
import type { Assignment, ExamResults, StudentHomework } from '../../types'
import { formatMinutes } from '../../utils/examTime'

// Оставшееся время: «1:05:09» или «4:59»
function formatLeft(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// Учитель: включить пробник у урока и задать время. Пустое поле — обычный урок
export function ExamSettings({ assignment, onSave }: {
  assignment: Assignment
  onSave: (changes: { exam_minutes?: number | null; exam_results?: ExamResults }) => Promise<void>
}) {
  const [value, setValue] = useState(assignment.exam_minutes ? String(assignment.exam_minutes) : '')
  const [error, setError] = useState('')

  async function save() {
    const minutes = value.trim() ? Number(value) : null
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) {
      setError('Время — от 1 до 600 минут')
      return
    }
    if (minutes === (assignment.exam_minutes ?? null)) return
    setError('')
    try {
      await onSave({ exam_minutes: minutes })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    }
  }

  return (
    <div className={styles.settings}>
      <label className={styles.settingsLabel}>
        ⏱ Пробник, минут:{' '}
        <input
          type="number"
          min={1}
          max={600}
          className={styles.minutes}
          placeholder="нет"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      {assignment.exam_minutes ? (
        <label className={styles.settingsLabel}>
          Ответы ученику:{' '}
          <select
            className={styles.select}
            value={assignment.exam_results ?? 'finish'}
            onChange={(e) => {
              setError('')
              onSave({ exam_results: e.target.value as ExamResults }).catch((err) =>
                setError(err instanceof Error ? err.message : 'Не удалось сохранить'),
              )
            }}
          >
            <option value="finish">сразу после сдачи</option>
            <option value="review">после проверки</option>
          </select>
        </label>
      ) : null}
      <span className={styles.hint}>
        {assignment.exam_minutes
          ? `${formatMinutes(assignment.exam_minutes)} с нажатия «Начать». До начала ученик не видит заданий.`
          : 'Укажите время, чтобы урок стал пробником с таймером'}
      </span>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}

// Ученик: начать пробник, таймер, сдать, итог
export function ExamBar({ assignment, answer, onChanged }: {
  assignment: Assignment
  answer?: StudentHomework
  onChanged: () => Promise<void> | void
}) {
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const finishingRef = useRef(false)

  const started = Boolean(answer?.exam_started_at)
  const over = Boolean(answer?.exam_over)
  const deadline = answer?.exam_deadline ? new Date(answer.exam_deadline).getTime() : null
  const left = deadline === null ? 0 : deadline - now
  const running = started && !over

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Что-то пошло не так')
    } finally {
      setBusy(false)
    }
  }

  // Время вышло — сдаём сами (ответы уже сохранены по ходу)
  useEffect(() => {
    if (!running || deadline === null || left > 0 || finishingRef.current) return
    finishingRef.current = true
    // Даём последним ответам сохраниться (автосохранение — через секунду после ввода)
    const timer = setTimeout(() => void run(() => api.finishExam(assignment.id!)), 1500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, deadline, left <= 0])

  if (!assignment.exam_minutes) return null

  if (!started) {
    const count = assignment.exam_task_count
    return (
      <section className={styles.bar}>
        <p className={styles.title}>⏱ Пробник · {formatMinutes(assignment.exam_minutes)}</p>
        <p className={styles.text}>
          {count ? `Заданий: ${count}. ` : ''}Задания откроются после нажатия «Начать». Время пойдёт сразу и не
          остановится, даже если закрыть страницу. Ответы сохраняются сами; когда время выйдет, работа сдастся
          автоматически.
        </p>
        <button
          type="button"
          className={styles.primary}
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Начать пробник? У вас будет ${formatMinutes(assignment.exam_minutes!)}.`)) {
              void run(() => api.startExam(assignment.id!))
            }
          }}
        >
          {busy ? 'Начинаем…' : 'Начать пробник'}
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </section>
    )
  }

  if (over) {
    const checks = Object.values(answer?.task_checks ?? {})
    const reviewed = answer?.status === 'accepted' || answer?.status === 'rejected'
    if (assignment.exam_results === 'review' && !reviewed) {
      return (
        <section className={`${styles.bar} ${styles.done}`}>
          <p className={styles.title}>✓ Пробник сдан</p>
          <p className={styles.text}>Результат появится, когда учитель проверит работу.</p>
        </section>
      )
    }
    return (
      <section className={`${styles.bar} ${styles.done}`}>
        <p className={styles.title}>✓ Пробник сдан</p>
        {checks.length > 0 ? (
          <p className={styles.score}>
            Верно {checks.filter(Boolean).length} из {checks.length}
          </p>
        ) : (
          <p className={styles.text}>Ответы отправлены учителю</p>
        )}
        <p className={styles.text}>Откройте номер, чтобы посмотреть, где ошибка.</p>
      </section>
    )
  }

  const urgent = left < 5 * 60 * 1000
  return (
    <section className={`${styles.bar} ${styles.running} ${urgent ? styles.urgent : ''}`} aria-live="polite">
      <div className={styles.timerRow}>
        <span className={styles.timer} role="timer">
          {left > 0 ? formatLeft(left) : 'Время вышло'}
        </span>
        <span className={styles.text}>{left > 0 ? 'осталось' : 'сдаём работу…'}</span>
      </div>
      <button
        type="button"
        className={styles.secondary}
        disabled={busy}
        onClick={() => {
          if (window.confirm('Завершить пробник? Изменить ответы после этого будет нельзя.')) {
            void run(() => api.finishExam(assignment.id!))
          }
        }}
      >
        {busy ? 'Сдаём…' : 'Завершить и сдать'}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  )
}
