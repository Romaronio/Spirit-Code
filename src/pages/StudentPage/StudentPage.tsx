import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import styles from './StudentPage.module.css'
import * as api from '../../services/api'
import ProgressDonut from '../../components/ProgressDonut/ProgressDonut'
import { StatusBadge } from '../../components/AnswerStatus/AnswerStatus'
import { formatActivity, studentStats, taskAnswerCount } from '../../utils/studentStats'
import type { Account, Assignment, Payment, TypingLanguage, TypingModeSummary, User } from '../../types'
import { canReview } from '../../utils/roles'

interface Props {
  user: User | null
  items: Assignment[]
  accounts: Account[]
}

const MODE_LABELS: Record<TypingLanguage, string> = {
  ru: 'Русский',
  en: 'English',
  ege: 'ЕГЭ лёгкий',
  ege_hard: 'ЕГЭ сложный',
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

const SHOWN_LESSONS = 5 // сколько последних уроков видно, пока список не раскрыт

function currentSchoolYear() {
  const now = new Date()
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
}

// Профиль ученика для учителя: прогресс по урокам, ответы, тренажёр печати, оплата
function StudentPage({ user, items, accounts }: Props) {
  const { id } = useParams()
  const studentId = Number(id)
  const [typing, setTyping] = useState<TypingModeSummary[] | null>(null)
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [allLessons, setAllLessons] = useState(false)
  const schoolYear = currentSchoolYear()

  const isTeacher = canReview(user?.role) // учитель и куратор
  const seesPayments = user?.role === 'teacher' // оплату видит только учитель
  useEffect(() => {
    if (!isTeacher || !studentId) return
    let cancelled = false
    api
      .getTypingByMode(studentId)
      .then((list) => !cancelled && setTyping(list))
      .catch(() => !cancelled && setTyping([]))
    if (seesPayments) api
      .getPayments(schoolYear)
      .then((list) => !cancelled && setPayments(list.filter((p) => p.student === studentId)))
      .catch(() => !cancelled && setPayments([]))
    return () => {
      cancelled = true
    }
  }, [isTeacher, seesPayments, studentId, schoolYear])

  if (!user) return <Navigate to="/" replace />
  if (!isTeacher) return <Navigate to="/home" replace />

  const student = accounts.find((a) => a.id === studentId && a.role === 'student')
  if (!student) {
    return (
      <div className={styles.page}>
        <Link to="/home" className={styles.back}>← На главную</Link>
        <p>{accounts.length ? 'Ученик не найден' : 'Загрузка…'}</p>
      </div>
    )
  }

  const stats = studentStats(student, items)
  const usedModes = (typing ?? []).filter((m) => m.tests > 0)
  const paid = new Set((payments ?? []).map((p) => p.month))
  // Уроки уже идут от новых к старым
  const shownLessons = allLessons ? stats.lessons : stats.lessons.slice(0, SHOWN_LESSONS)

  return (
    <div className={styles.page}>
      <Link to="/home" className={styles.back}>← На главную</Link>

      <header className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">{student.name.trim().charAt(0).toUpperCase()}</span>
        <div className={styles.headerText}>
          <h1 className={styles.name}>{student.name}</h1>
          <div className={styles.subjects}>
            {(student.subjects ?? []).length ? (
              student.subjects!.map((s) => <span key={s} className={styles.subject}>{s}</span>)
            ) : (
              <span className={styles.muted}>Предметы не выбраны</span>
            )}
          </div>
          <p className={styles.muted}>Последняя активность: {formatActivity(stats.lastActivity)}</p>
        </div>
      </header>

      {seesPayments && <ParentLink studentId={student.id!} />}

      <section className={styles.tiles} aria-label="Статистика">
        <div className={`${styles.tile} ${styles.progressTile}`}>
          <ProgressDonut done={stats.accepted} total={stats.total} />
          <div>
            <span className={styles.tileValue}>
              {stats.accepted} из {stats.total}
            </span>
            <span className={styles.tileLabel}>уроков сдано</span>
          </div>
        </div>
        <Tile value={stats.pending} label="на проверке" tone={stats.pending ? 'amber' : undefined} />
        <Tile value={stats.rejected} label="не сдано — на доработке" tone={stats.rejected ? 'danger' : undefined} />
        <Tile value={stats.notSent} label="ещё не отправлено" />
        <Tile value={stats.taskAnswers} label="ответов к заданиям" />
      </section>

      <section className={styles.card}>
        {/* Заголовок слева, «Раскрыть все уроки» — справа сверху */}
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Уроки · {stats.total}</h2>
          {stats.total > SHOWN_LESSONS && (
            <button
              type="button"
              className={styles.expand}
              aria-expanded={allLessons}
              onClick={() => setAllLessons((v) => !v)}
            >
              {allLessons ? 'Свернуть' : `Раскрыть все уроки · ${stats.total}`}
            </button>
          )}
        </div>
        {stats.total === 0 ? (
          <p className={styles.muted}>По предметам ученика уроков пока нет</p>
        ) : (
          <ul className={styles.lessons}>
            {shownLessons.map(({ lesson, answer }) => {
              const answered = taskAnswerCount(answer)
              return (
                <li key={lesson.id} className={styles.lesson}>
                  <div className={styles.lessonText}>
                    <Link to={`/assignment/${lesson.id}`} className={styles.lessonTitle}>{lesson.title}</Link>
                    <span className={styles.muted}>
                      {[
                        lesson.subject,
                        answer?.submitted_at && `отправлен ${new Date(answer.submitted_at).toLocaleDateString('ru-RU')}`,
                        answered > 0 && `ответов к заданиям: ${answered}`,
                        lesson.deadline && `сдать до ${lesson.deadline}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  {answer ? <StatusBadge answer={answer} /> : <span className={styles.notSent}>Не отправлено</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className={styles.twoCols}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Тренажёр печати</h2>
          {typing === null ? (
            <p className={styles.muted}>Загрузка…</p>
          ) : usedModes.length === 0 ? (
            <p className={styles.muted}>Ещё не занимался</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Режим</th>
                  <th title="Слов в минуту">Лучший</th>
                  <th title="Средняя скорость за последние 10 попыток">Средний</th>
                  <th>Точность</th>
                  <th>Попыток</th>
                </tr>
              </thead>
              <tbody>
                {usedModes.map((m) => (
                  <tr key={m.language}>
                    <td>{MODE_LABELS[m.language]}</td>
                    <td>{m.best_wpm ?? '—'}</td>
                    <td>{m.avg_wpm ?? '—'}</td>
                    <td>{m.avg_accuracy === null ? '—' : `${m.avg_accuracy}%`}</td>
                    <td>{m.tests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {seesPayments && <section className={styles.card}>
          <h2 className={styles.cardTitle}>
            Оплата · {schoolYear}/{schoolYear + 1}
          </h2>
          {payments === null ? (
            <p className={styles.muted}>Загрузка…</p>
          ) : (
            <>
              <div className={styles.months}>
                {MONTHS.map(({ month, label }) => (
                  <span
                    key={month}
                    className={`${styles.month} ${paid.has(month) ? styles.paid : ''}`}
                    title={paid.has(month) ? 'Оплачено' : 'Не оплачено'}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <p className={styles.muted}>
                Оплачено месяцев: {paid.size} · отметить оплату можно в панели «Оплата» на главной
              </p>
            </>
          )}
        </section>}
      </div>
    </div>
  )
}

// Ссылка для родителей: по ней без входа видны все домашки ученика и процент выполнения.
// Выдаёт учитель; «Сменить ссылку» — старая сразу перестаёт работать
function ParentLink({ studentId }: { studentId: number }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function load(renew: boolean) {
    if (renew && !window.confirm('Сделать новую ссылку? Старая сразу перестанет открываться — родителям нужно будет прислать новую.')) return
    setBusy(true)
    setError('')
    try {
      const { token } = await api.getParentLink(studentId, renew)
      setUrl(`${window.location.origin}/parent/${token}`)
      setCopied(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить ссылку')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Не удалось скопировать — выделите ссылку и скопируйте вручную')
    }
  }

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Ссылка для родителей</h2>
      <p className={styles.muted}>
        По ссылке без входа видны все домашние задания ученика и процент их выполнения. Ответы и переписка не видны.
      </p>
      {url ? (
        <div className={styles.parentLink}>
          <input className={styles.parentInput} value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className={styles.parentButton} onClick={copy}>
            {copied ? '✓ Скопировано' : 'Копировать'}
          </button>
          <a className={styles.parentButton} href={url} target="_blank" rel="noreferrer">
            Открыть
          </a>
          <button type="button" className={styles.parentSecondary} onClick={() => load(true)} disabled={busy}>
            Сменить ссылку
          </button>
        </div>
      ) : (
        <div className={styles.parentLink}>
          <button type="button" className={styles.parentButton} onClick={() => load(false)} disabled={busy}>
            {busy ? 'Загрузка…' : 'Показать ссылку'}
          </button>
        </div>
      )}
      {error && <p className={styles.parentError}>{error}</p>}
    </section>
  )
}

function Tile({ value, label, tone }: { value: number; label: string; tone?: 'amber' | 'danger' }) {
  return (
    <div className={styles.tile}>
      <span className={`${styles.tileValue} ${tone ? styles[tone] : ''}`}>{value}</span>
      <span className={styles.tileLabel}>{label}</span>
    </div>
  )
}

export default StudentPage
