import { useState, type FormEvent } from 'react'
import styles from './StudentsPanel.module.css'
import type { Account } from '../../types'
import { hasSubject, toggleSubject, uniqueSubjects } from '../../utils/subjects'

interface Props {
  accounts: Account[]
  availableSubjects: string[]
  onAddStudent: (student: Omit<Account, 'id'>) => Promise<void>
  onDeleteStudent: (id: number) => void
  onSetSubjects: (id: number, subjects: string[]) => void
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
  availableSubjects,
  onAddStudent,
  onDeleteStudent,
  onSetSubjects,
}: Props) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [newSubjects, setNewSubjects] = useState<string[]>([])
  const [error, setError] = useState('')
  // Сервер хранит только хэш, поэтому пароль показываем один раз — сразу после добавления
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null)
  const [isOpen, setIsOpen] = useState(false) // по умолчанию свёрнута
  const [isSaving, setIsSaving] = useState(false)

  const students = accounts.filter((a) => a.role === 'student')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmedName = name.trim()

    if (trimmedName === '') {
      setError('Введите имя ученика')
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
        role: 'student',
        subjects: newSubjects,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить ученика')
      return
    } finally {
      setIsSaving(false)
    }
    setCreated({ name: trimmedName, password })
    setName('')
    setPassword('')
    setNewSubjects([])
    setError('')
  }

  function handleDelete(studentId: number, studentName: string) {
    if (window.confirm(`Удалить ученика «${studentName}»?`)) {
      onDeleteStudent(studentId)
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h2>
          Ученики <span className={styles.count}>({students.length})</span>
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
            <input
              type="text"
              placeholder="Имя ученика"
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

            <p className={styles.label}>Предметы ученика</p>
            <SubjectPicker
              options={availableSubjects}
              selected={newSubjects}
              onToggle={(subject) => setNewSubjects((prev) => toggleSubject(prev, subject))}
            />

            {error && <p className={styles.error}>{error}</p>}
            {created && (
              <p className={styles.hint}>
                Ученик «{created.name}» добавлен. Пароль: <b>{created.password}</b> — передайте
                его ученику, позже посмотреть его будет нельзя.
              </p>
            )}

            <button type="submit" className={styles.submit} disabled={isSaving}>
              {isSaving ? 'Добавление...' : 'Добавить ученика'}
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
                        className={styles.delete}
                        onClick={() => handleDelete(s.id!, s.name)}
                      >
                        Удалить
                      </button>
                    </div>

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
        </>
      )}
    </section>
  )
}

export default StudentsPanel