import { useState, type FormEvent } from 'react'
import styles from './StudentsPanel.module.css'
import type { Account } from '../../types'

interface Props {
  accounts: Account[]
  onAddStudent: (student: Account) => void
  onDeleteStudent: (name: string) => void
}

const MIN_PASSWORD_LENGTH = 4

function generatePassword(length = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

function StudentsPanel({ accounts, onAddStudent, onDeleteStudent }: Props) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const students = accounts.filter((a) => a.role === 'student')

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
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
      setError('Пользователь с таким именем уже существует')
      return
    }

    onAddStudent({ name: trimmedName, password, role: 'student' })
    setName('')
    setPassword('')
    setError('')
  }

  function handleDelete(studentName: string) {
    if (window.confirm(`Удалить ученика «${studentName}»?`)) {
      onDeleteStudent(studentName)
    }
  }

  return (
    <section className={styles.panel}>
      <h2>Ученики</h2>

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

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.submit}>
          Добавить ученика
        </button>
      </form>

      {students.length === 0 ? (
        <p className={styles.empty}>Учеников пока нет</p>
      ) : (
        <ul className={styles.list}>
          {students.map((s) => (
            <li key={s.name}>
              <span className={styles.studentName}>{s.name}</span>
              <span className={styles.password}>{s.password}</span>
              <button
                type="button"
                className={styles.delete}
                onClick={() => handleDelete(s.name)}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default StudentsPanel