import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './CallsBar.module.css'
import * as api from '../../services/api'
import type { Account, Assignment, Call } from '../../types'
import { callName } from '../../utils/calls'
import { hasSubject, lessonForSubjects, lessonSubjects } from '../../utils/subjects'

// Как часто проверяем, не начался ли урок. Запрос лёгкий, а постоянное соединение
// заняло бы один из двух обработчиков gunicorn — поэтому частый опрос
const POLL_INTERVAL_MS = 3_000

interface Props {
  isTeacher: boolean
  subjects: string[] // предметы для выбора у учителя
  students: Account[] // ученики для личного урока
  lessons?: Assignment[] // уроки, задания которых можно открыть в созвоне
}

const STUDENT_PREFIX = 'student:' // значение в списке «Для кого»: предмет или student:<id>

// Созвоны на главной: учитель начинает урок и видит идущие,
// ученик видит плашку «Идёт урок — подключиться» (если урока нет — ничего)
function CallsBar({ isTeacher, subjects, students, lessons = [] }: Props) {
  const navigate = useNavigate()
  const [calls, setCalls] = useState<Call[]>([])
  const [audience, setAudience] = useState('') // '' — все, предмет или student:<id>
  const [title, setTitle] = useState('')
  const [lessonId, setLessonId] = useState('') // '' — без урока
  const [error, setError] = useState('')
  const [isStarting, setIsStarting] = useState(false)

  async function load() {
    try {
      setCalls(await api.getCalls())
    } catch (err) {
      console.error('Ошибка загрузки созвонов:', err)
    }
  }

  // Список идущих уроков обновляем каждые 3 секунды, пока вкладка на экране,
  // и сразу, когда пользователь вернулся на вкладку
  useEffect(() => {
    let alive = true
    let loading = false // медленный ответ — не шлём следующий запрос поверх
    const refresh = () => {
      if (loading || document.visibilityState !== 'visible') return
      loading = true
      api
        .getCalls()
        .then((list) => {
          if (alive) setCalls(list)
        })
        .catch((err) => console.error('Ошибка загрузки созвонов:', err))
        .finally(() => {
          loading = false
        })
    }
    refresh()
    const timer = window.setInterval(refresh, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  async function handleStart(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setIsStarting(true)
    try {
      const student = audience.startsWith(STUDENT_PREFIX) ? Number(audience.slice(STUDENT_PREFIX.length)) : null
      const assignment = lessonOptions.some((l) => String(l.id) === lessonId) ? Number(lessonId) : null
      const call = await api.startCall({ subject: student ? '' : audience, student, title: title.trim(), assignment })
      navigate(`/call/${call.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось начать урок')
      setIsStarting(false)
    }
  }

  async function handleEnd(call: Call) {
    if (!window.confirm(`Завершить урок «${callName(call)}» для всех?`)) return
    try {
      await api.endCall(call.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить урок')
    }
    load()
  }

  if (!isTeacher && calls.length === 0) return null

  // Уроки для выбора — по выбранному предмету или по предметам ученика, новые сверху
  const personal = audience.startsWith(STUDENT_PREFIX)
    ? students.find((s) => `${STUDENT_PREFIX}${s.id}` === audience)
    : undefined
  const lessonOptions = [...lessons]
    .filter((l) => (personal ? lessonForSubjects(personal.subjects, l) : !audience || hasSubject(lessonSubjects(l), audience)))
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))

  return (
    <section className={styles.bar} aria-label="Онлайн-уроки">
      {calls.map((call) => (
        <div key={call.id} className={styles.live}>
          <span className={styles.dot} aria-hidden="true" />
          <div className={styles.liveText}>
            <span className={styles.liveTitle}>Идёт урок · {callName(call)}</span>
            <span className={styles.liveMeta}>
              начал {call.started_by_name} в {formatTime(call.started_at)}
            </span>
          </div>
          <button type="button" className={styles.join} onClick={() => navigate(`/call/${call.id}`)}>
            {isTeacher ? 'Войти' : 'Подключиться'}
          </button>
          {isTeacher && (
            <button type="button" className={styles.end} onClick={() => handleEnd(call)}>
              Завершить
            </button>
          )}
        </div>
      ))}

      {isTeacher && (
        <form className={styles.start} onSubmit={handleStart}>
          <span className={styles.startLabel}>Онлайн-урок</span>
          <label className={styles.field}>
            <span className={styles.visuallyHidden}>Для кого</span>
            <select value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="">Все ученики</option>
              {subjects.length > 0 && (
                <optgroup label="По предмету">
                  {subjects.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </optgroup>
              )}
              {students.length > 0 && (
                <optgroup label="Лично с учеником">
                  {students.map((s) => (
                    <option key={s.id} value={`${STUDENT_PREFIX}${s.id}`}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.visuallyHidden}>Тема урока</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Тема (необязательно)"
              maxLength={255}
            />
          </label>
          {lessonOptions.length > 0 && (
            <label className={styles.field}>
              <span className={styles.visuallyHidden}>Задания урока</span>
              <select value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
                <option value="">Без заданий</option>
                {lessonOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title} · {l.subject}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className={styles.join} disabled={isStarting}>
            {isStarting ? 'Начинаем…' : 'Начать урок'}
          </button>
        </form>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </section>
  )
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export default CallsBar
