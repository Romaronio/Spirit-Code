import { useState, type FormEvent } from 'react'
import styles from './StudentsPanel.module.css'
import type { Account } from '../../types'
import { hasSubject, toggleSubject, uniqueSubjects } from '../../utils/subjects'
import * as api from '../../services/api'

type NewRole = 'student' | 'curator' | 'teacher'

const ROLE_OPTIONS: { role: NewRole; label: string; who: string }[] = [
  { role: 'student', label: 'Ученик', who: 'ученика' },
  { role: 'curator', label: 'Куратор', who: 'куратора' },
  { role: 'teacher', label: 'Учитель', who: 'учителя' },
]

interface Props {
  accounts: Account[]
  currentUserId?: number
  isOwner: boolean // создатель: добавляет и удаляет учителей и кураторов, остальные учителя — только учеников
  availableSubjects: string[]
  onAddStudent: (student: Omit<Account, 'id'>) => Promise<void>
  onDeleteStudent: (id: number) => void
  onSetSubjects: (id: number, subjects: string[]) => void
  onSetCuratorStudents?: (id: number, students: number[]) => Promise<void>
}

const MIN_PASSWORD_LENGTH = 8 // как на сервере (api/serializers.py)

function generatePassword(length = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

interface PickerProps {
  options: string[]
  selected: string[]
  onToggle: (subject: string) => void
}

function SubjectPicker({ options, selected, onToggle }: PickerProps) {
  if (options.length === 0) {
    return (
      <p className={styles.hint}>
        Предметов пока нет: они появятся, когда вы создадите задания
      </p>
    )
  }

  return (
    <div className={styles.subjects}>
      {options.map((subject) => (
        <label key={subject} className={styles.subject}>
          <input
            type="checkbox"
            checked={hasSubject(selected, subject)}
            onChange={() => onToggle(subject)}
          />
          {subject}
        </label>
      ))}
    </div>
  )
}

function StudentsPanel({
  accounts,
  currentUserId,
  isOwner,
  availableSubjects,
  onAddStudent,
  onDeleteStudent,
  onSetSubjects,
  onSetCuratorStudents,
}: Props) {
  // У какого куратора раскрыт выбор учеников
  const [pickingFor, setPickingFor] = useState<number | null>(null)
  const [pickError, setPickError] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [newSubjects, setNewSubjects] = useState<string[]>([])
  // Кого добавляем: ученика или куратора (куратор проверяет ДЗ, но не меняет уроки)
  const [newRole, setNewRole] = useState<NewRole>('student')
  const [error, setError] = useState('')
  // Сервер хранит только хэш, поэтому пароль показываем один раз — сразу после добавления
  const [created, setCreated] = useState<{ name: string; password: string; role: NewRole } | null>(null)
  const [isOpen, setIsOpen] = useState(false) // по умолчанию свёрнута
  const [isSaving, setIsSaving] = useState(false)
  // Сброс пароля: новый пароль тоже показываем один раз, под строкой ученика
  const [resettingId, setResettingId] = useState<number | null>(null)
  const [reset, setReset] = useState<{ id: number; password?: string; error?: string } | null>(null)

  const students = accounts.filter((a) => a.role === 'student')
  // Учителей и кураторов видит и меняет только создатель
  const staff = isOwner ? accounts.filter((a) => (a.role === 'curator' || a.role === 'teacher') && a.id !== currentUserId) : []
  const curators = staff.filter((a) => a.role === 'curator')
  const role: NewRole = isOwner ? newRole : 'student'
  const who = ROLE_OPTIONS.find((o) => o.role === role)!.who

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmedName = name.trim()

    if (trimmedName === '') {
      setError(`Введите имя ${who}`)
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`)
      return
    }
    const taken = accounts.some(
      (a) => a.name.toLowerCase() === trimmedName.toLowerCase()
    )
    if (taken) {
      setError('Пользователь с таким именем уже существует, придумайте другое имя')
      return
    }

    setIsSaving(true)
    try {
      await onAddStudent({
        name: trimmedName,
        password,
        role,
        subjects: role === 'student' ? newSubjects : [],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : `Не удалось добавить ${who}`)
      return
    } finally {
      setIsSaving(false)
    }
    setCreated({ name: trimmedName, password, role })
    setName('')
    setPassword('')
    setNewSubjects([])
    setError('')
  }

  async function handleResetPassword(studentId: number, studentName: string) {
    if (!window.confirm(`Сбросить пароль «${studentName}»? Старый пароль перестанет работать.`)) {
      return
    }
    setResettingId(studentId)
    setReset(null)
    try {
      const { password } = await api.resetPassword(studentId)
      setReset({ id: studentId, password })
    } catch (err) {
      setReset({ id: studentId, error: err instanceof Error ? err.message : 'Не удалось сбросить пароль' })
    } finally {
      setResettingId(null)
    }
  }

  function handleDelete(studentId: number, studentName: string) {
    if (window.confirm(`Удалить «${studentName}»?`)) {
      onDeleteStudent(studentId)
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h2>
          Ученики <span className={styles.count}>({students.length})</span>
          {curators.length > 0 && <span className={styles.count}> · кураторы ({curators.length})</span>}
          {staff.length > curators.length && (
            <span className={styles.count}> · учителя ({staff.length - curators.length})</span>
          )}
        </h2>
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
          <form className={styles.form} onSubmit={handleSubmit}>
            {/* Учителей и кураторов добавляет только создатель платформы */}
            {isOwner && (
              <div className={styles.roleSwitch} role="group" aria-label="Кого добавить">
                {ROLE_OPTIONS.map((o) => (
                  <button
                    key={o.role}
                    type="button"
                    aria-pressed={role === o.role}
                    onClick={() => {
                      setNewRole(o.role)
                      setError('')
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
            {role === 'curator' && (
              <p className={styles.hint}>
                Куратор видит все уроки и ответы учеников, ставит «Сдано» / «Не сдано» и пишет ученикам.
                Создавать и менять уроки, учеников, оплату и созвоны он не может.
              </p>
            )}
            {role === 'teacher' && (
              <p className={styles.hint}>
                Учитель может всё то же, что и вы, кроме добавления учителей и кураторов: учеников он добавлять может.
              </p>
            )}
            <input
              type="text"
              placeholder={`Имя ${who}`}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
            />

            <div className={styles.passwordRow}>
              <input
                type="text"
                placeholder="Пароль"
                autoComplete="off"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError('')
                }}
              />
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setPassword(generatePassword())
                  setError('')
                }}
              >
                Сгенерировать
              </button>
            </div>

            {role === 'student' && (
              <>
                <p className={styles.label}>Предметы ученика</p>
                <SubjectPicker
                  options={availableSubjects}
                  selected={newSubjects}
                  onToggle={(subject) => setNewSubjects((prev) => toggleSubject(prev, subject))}
                />
              </>
            )}

            {error && <p className={styles.error}>{error}</p>}
            {created && (
              <p className={styles.hint}>
                {ROLE_OPTIONS.find((o) => o.role === created.role)!.label} «{created.name}» добавлен. Пароль:{' '}
                <b>{created.password}</b> — передайте его, позже посмотреть его будет нельзя.
              </p>
            )}

            <button type="submit" className={styles.submit} disabled={isSaving}>
              {isSaving ? 'Добавление...' : `Добавить ${who}`}
            </button>
          </form>

          {students.length === 0 ? (
            <p className={styles.empty}>Учеников пока нет</p>
          ) : (
            <ul className={styles.list}>
              {students.map((s) => {
                const current = s.subjects ?? []
                // показываем и предметы, которые уже назначены, даже если заданий по ним нет
                const options = uniqueSubjects([...availableSubjects, ...current])

                return (
                  <li key={s.id}>
                    <div className={styles.studentRow}>
                      <span className={styles.studentName}>{s.name}</span>
                      <button
                        type="button"
                        className={styles.reset}
                        onClick={() => handleResetPassword(s.id!, s.name)}
                        disabled={resettingId === s.id}
                      >
                        {resettingId === s.id ? 'Сброс...' : 'Сбросить пароль'}
                      </button>
                      <button
                        type="button"
                        className={styles.delete}
                        onClick={() => handleDelete(s.id!, s.name)}
                      >
                        Удалить
                      </button>
                    </div>

                    {reset && reset.id === s.id && (
                      reset.error ? (
                        <p className={styles.error}>{reset.error}</p>
                      ) : (
                        <p className={styles.hint}>
                          Новый пароль: <b className={styles.newPassword}>{reset.password}</b> — передайте
                          его ученику, позже посмотреть его будет нельзя.
                        </p>
                      )
                    )}

                    <SubjectPicker
                      options={options}
                      selected={current}
                      onToggle={(subject) =>
                        onSetSubjects(s.id!, toggleSubject(current, subject))
                      }
                    />
                  </li>
                )
              })}
            </ul>
          )}

          {staff.length > 0 && (
            <>
              <p className={styles.label}>Учителя и кураторы</p>
              <ul className={styles.list}>
                {staff.map((c) => (
                  <li key={c.id}>
                    <div className={styles.studentRow}>
                      <span className={styles.studentName}>
                        {c.name} <span className={styles.count}>· {c.role === 'teacher' ? 'учитель' : 'куратор'}</span>
                      </span>
                      <button
                        type="button"
                        className={styles.reset}
                        onClick={() => handleResetPassword(c.id!, c.name)}
                        disabled={resettingId === c.id}
                      >
                        {resettingId === c.id ? 'Сброс...' : 'Сбросить пароль'}
                      </button>
                      <button type="button" className={styles.delete} onClick={() => handleDelete(c.id!, c.name)}>
                        Удалить
                      </button>
                    </div>
                    {reset && reset.id === c.id && (
                      reset.error ? (
                        <p className={styles.error}>{reset.error}</p>
                      ) : (
                        <p className={styles.hint}>
                          Новый пароль: <b className={styles.newPassword}>{reset.password}</b> — передайте
                          его, позже посмотреть его будет нельзя.
                        </p>
                      )
                    )}

                    {/* Куратор видит и проверяет только закреплённых за ним учеников — из любых групп */}
                    {c.role === 'curator' && onSetCuratorStudents && (
                      <CuratorStudents
                        curator={c}
                        students={students}
                        isOpen={pickingFor === c.id}
                        error={pickingFor === c.id ? pickError : ''}
                        onToggleOpen={() => {
                          setPickingFor(pickingFor === c.id ? null : c.id!)
                          setPickError('')
                        }}
                        onChange={async (ids) => {
                          setPickError('')
                          try {
                            await onSetCuratorStudents(c.id!, ids)
                          } catch (err) {
                            setPickError(err instanceof Error ? err.message : 'Не удалось сохранить')
                          }
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}

interface CuratorStudentsProps {
  curator: Account
  students: Account[]
  isOpen: boolean
  error: string
  onToggleOpen: () => void
  onChange: (ids: number[]) => Promise<void>
}

// Ученики куратора: сколько закреплено и, по кнопке, список всех учеников с галочками
function CuratorStudents({ curator, students, isOpen, error, onToggleOpen, onChange }: CuratorStudentsProps) {
  const selected = new Set(curator.students ?? [])
  const names = students.filter((s) => selected.has(s.id!)).map((s) => s.name)
  const [query, setQuery] = useState('')
  const shown = students.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className={styles.curatorStudents}>
      <p className={styles.hint}>
        {names.length ? `Ученики (${names.length}): ${names.join(', ')}` : 'Ученики не закреплены — куратор пока ничего не видит'}
      </p>
      <button type="button" className={styles.secondary} onClick={onToggleOpen} aria-expanded={isOpen}>
        {isOpen ? 'Готово' : 'Выбрать учеников'}
      </button>
      {isOpen && (
        <>
          {students.length > 8 && (
            <input type="search" placeholder="Найти ученика" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
          <div className={styles.subjects}>
            {shown.map((s) => (
              <label key={s.id} className={styles.subject}>
                <input
                  type="checkbox"
                  checked={selected.has(s.id!)}
                  onChange={() => {
                    const next = new Set(selected)
                    if (next.has(s.id!)) next.delete(s.id!)
                    else next.add(s.id!)
                    void onChange([...next])
                  }}
                />
                {s.name}
                {(s.subjects ?? []).length > 0 && <span className={styles.studentSubjects}> · {s.subjects!.join(', ')}</span>}
              </label>
            ))}
          </div>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

export default StudentsPanel