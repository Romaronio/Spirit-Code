import { useState, type DragEvent, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import styles from './LessonsPage.module.css'
import { hasSubject, lessonSubjects, normalize, uniqueSubjects } from '../../utils/subjects'
import type { Assignment, AssignmentChanges, Subject, User } from '../../types'

interface Props {
  user: User | null
  items: Assignment[]
  subjects: Subject[]
  onUpdate: (id: Assignment['id'], changes: AssignmentChanges) => Promise<void>
  onAddSubject: (name: string) => Promise<void>
}

const DRAG_TYPE = 'application/x-spirit-lesson' // при перетаскивании передаём {id, from}

// Из этих предметов урок не уходит: перенос добавляет его в новый предмет, а здесь он остаётся
const BASE_SUBJECTS = ['Математика', 'Информатика', 'Русский язык']
const isBase = (subject: string) => hasSubject(BASE_SUBJECTS, subject)

// Новые предметы урока: основной остаётся основным, пока он есть в списке
function withSubjects(lesson: Assignment, subjects: string[]): AssignmentChanges {
  const main = subjects.find((s) => normalize(s) === normalize(lesson.subject)) ?? subjects[0]
  return { subject: main, extra_subjects: subjects.filter((s) => s !== main) }
}

// База уроков (только учитель): все уроки по предметам. Один урок может быть в нескольких предметах
// (это тот же урок, не копия). Урок переносят перетаскиванием мышкой или списком у урока; из Математики,
// Информатики и Русского он добавляется в новый предмет и остаётся на месте. Урок видят ученики,
// у которых есть любой из его предметов
function LessonsPage({ user, items, subjects, onUpdate, onAddSubject }: Props) {
  const [query, setQuery] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [movingId, setMovingId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  if (!user) return <Navigate to="/" replace />
  if (user.role !== 'teacher') return <Navigate to="/home" replace />

  // Предметы из списка и предметы уроков — урок по удалённому из списка предмету не теряется
  const groups = uniqueSubjects([...subjects.map((s) => s.name), ...items.flatMap(lessonSubjects)])
  const search = normalize(query)
  const matches = (a: Assignment) => !search || normalize(a.title).includes(search)
  const lessonsOf = (subject: string) =>
    items
      .filter((a) => hasSubject(lessonSubjects(a), subject) && matches(a))
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))

  async function save(lesson: Assignment, next: string[], message: string) {
    if (!lesson.id) return
    setMovingId(lesson.id)
    setError('')
    setNotice('')
    try {
      await onUpdate(lesson.id, withSubjects(lesson, next))
      setNotice(message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось перенести урок')
    } finally {
      setMovingId(null)
    }
  }

  // Из базового предмета урок копируется, из остальных — переносится
  function move(lesson: Assignment, from: string, to: string) {
    const current = lessonSubjects(lesson)
    if (hasSubject(current, to)) {
      setNotice(`«${lesson.title}» уже есть в «${to}»`)
      return
    }
    if (isBase(from)) {
      void save(lesson, [...current, to], `«${lesson.title}» добавлен в «${to}» и остался в «${from}»`)
    } else {
      const rest = current.filter((s) => normalize(s) !== normalize(from))
      void save(lesson, [...rest, to], `«${lesson.title}» перенесён в «${to}»`)
    }
  }

  function removeFrom(lesson: Assignment, subject: string) {
    const rest = lessonSubjects(lesson).filter((s) => normalize(s) !== normalize(subject))
    if (rest.length === 0) return
    if (!window.confirm(`Убрать «${lesson.title}» из «${subject}»? Урок останется в «${rest.join('», «')}».`)) return
    void save(lesson, rest, `«${lesson.title}» убран из «${subject}»`)
  }

  async function handleAddSubject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = newSubject.trim().replace(/\s+/g, ' ')
    if (!name) return
    setError('')
    try {
      await onAddSubject(name)
      setNewSubject('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить предмет')
    }
  }

  function handleDrop(e: DragEvent, subject: string) {
    e.preventDefault()
    setDropTarget(null)
    let data: { id?: number; from?: string }
    try {
      data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE))
    } catch {
      return
    }
    const lesson = items.find((a) => a.id === data.id)
    if (lesson && data.from && normalize(data.from) !== normalize(subject)) move(lesson, data.from, subject)
  }

  return (
    <div className={styles.page}>
      <Link to="/home" className={styles.back}>
        ← На главную
      </Link>
      <h1 className={styles.title}>База уроков</h1>
      <p className={styles.subtitle}>
        Все уроки по предметам. Перетащите урок мышкой в другой предмет или выберите предмет в списке у урока.
        Из Математики, Информатики и Русского языка урок добавляется в новый предмет и остаётся на месте,
        из остальных — переносится. Урок видят ученики, у которых есть любой из его предметов.
      </p>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          placeholder="Найти урок по названию"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <form className={styles.addSubject} onSubmit={handleAddSubject}>
          <input
            type="text"
            placeholder="Новый предмет, например ОГЭ информатика"
            value={newSubject}
            maxLength={100}
            onChange={(e) => setNewSubject(e.target.value)}
          />
          <button type="submit" className={styles.primary} disabled={!newSubject.trim()}>
            + Добавить предмет
          </button>
        </form>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      <div className={styles.groups}>
        {groups.map((subject) => {
          const lessons = lessonsOf(subject)
          if (search && lessons.length === 0) return null
          return (
            <section
              key={subject}
              className={`${styles.group} ${dropTarget === subject ? styles.dropTarget : ''}`}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move' // из базовых предметов урок всё равно копируется — см. move()
                if (dropTarget !== subject) setDropTarget(subject)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
              }}
              onDrop={(e) => handleDrop(e, subject)}
            >
              <h2 className={styles.groupTitle}>
                {subject} <span className={styles.count}>{lessons.length}</span>
              </h2>
              {lessons.length === 0 ? (
                <p className={styles.empty}>Уроков нет — перетащите сюда</p>
              ) : (
                <ul className={styles.lessons}>
                  {lessons.map((lesson) => (
                    <LessonRow
                      key={lesson.id}
                      lesson={lesson}
                      subject={subject}
                      groups={groups}
                      busy={movingId !== null}
                      moving={movingId === lesson.id}
                      onMove={(to) => move(lesson, subject, to)}
                      onRemove={() => removeFrom(lesson, subject)}
                      onDragEnd={() => setDropTarget(null)}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

interface RowProps {
  lesson: Assignment
  subject: string // предмет, в колонке которого показан урок
  groups: string[]
  busy: boolean
  moving: boolean
  onMove: (to: string) => void
  onRemove: () => void
  onDragEnd: () => void
}

function LessonRow({ lesson, subject, groups, busy, moving, onMove, onRemove, onDragEnd }: RowProps) {
  const current = lessonSubjects(lesson)
  const others = current.filter((s) => normalize(s) !== normalize(subject))
  const copies = isBase(subject)

  return (
    <li
      className={`${styles.lesson} ${moving ? styles.moving : ''}`}
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id: lesson.id, from: subject }))
        e.dataTransfer.effectAllowed = 'copyMove' // курсор при наведении задаёт колонка
      }}
      onDragEnd={onDragEnd}
    >
      <span className={styles.handle} aria-hidden="true">⋮⋮</span>
      <div className={styles.lessonText}>
        <Link to={`/assignment/${lesson.id}`} className={styles.lessonTitle}>
          {lesson.title}
        </Link>
        <span className={styles.meta}>{lessonMeta(lesson)}</span>
        {others.length > 0 && <span className={styles.also}>Также в: {others.join(', ')}</span>}
      </div>
      <div className={styles.lessonActions}>
        <label className={styles.moveField}>
          <span className={styles.visuallyHidden}>{copies ? 'Добавить урок в предмет' : 'Перенести урок в предмет'}</span>
          <select value="" disabled={busy} onChange={(e) => e.target.value && onMove(e.target.value)}>
            <option value="">{copies ? 'Добавить в…' : 'Перенести в…'}</option>
            {groups
              .filter((g) => !hasSubject(current, g))
              .map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
          </select>
        </label>
        {others.length > 0 && (
          <button
            type="button"
            className={styles.removeFrom}
            disabled={busy}
            title={`Убрать урок из «${subject}»`}
            aria-label={`Убрать урок из «${subject}»`}
            onClick={onRemove}
          >
            ✕
          </button>
        )}
      </div>
    </li>
  )
}

// «3 номера класс · 2 дз · сдать до 2026-11-05 · создан 01.11.2026»
function lessonMeta(lesson: Assignment) {
  const parts: string[] = []
  const classwork = lesson.numbered_tasks?.length ?? 0
  const homework = lesson.homework?.numbered_tasks?.length ?? 0
  if (classwork) parts.push(`${classwork} ${plural(classwork, 'номер', 'номера', 'номеров')} класс`)
  if (homework) parts.push(`${homework} дз`)
  if (lesson.deadline) parts.push(`сдать до ${lesson.deadline}`)
  if (lesson.created_at) parts.push(`создан ${new Date(lesson.created_at).toLocaleDateString('ru-RU')}`)
  return parts.join(' · ')
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export default LessonsPage
