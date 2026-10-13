import { useState, type FormEvent } from 'react'
import styles from './AssignmentForm.module.css'
import type { Assignment } from '../../types'

interface AssignmentFormProps {
  onAdd: (assignment: Omit<Assignment, 'id'>) => void
}

const SUBJECTS = ['Математика', 'Информатика', 'Русский язык']

function AssignmentForm({ onAdd }: AssignmentFormProps) {
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (title.trim() === '' || subject === '' || deadline === '') {
      setError('Заполните название, предмет и срок сдачи')
      return
    }

    onAdd({
      title: title.trim(),
      subject: subject,
      description: description.trim(),
      deadline,
    })

    setTitle('')
    setSubject('')
    setDescription('')
    setDeadline('')
    setError('')
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2>Новое задание</h2>

      <input
        type="text"
        placeholder="Название"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className={styles.subjectSection}>
        <label className={styles.label}>Предмет</label>
        <div className={styles.subjectOptions}>
          {SUBJECTS.map((subj) => (
            <label key={subj} className={styles.radioLabel}>
              <input
                type="radio"
                name="subject"
                value={subj}
                checked={subject === subj}
                onChange={(e) => setSubject(e.target.value)}
              />
              {subj}
            </label>
          ))}
        </div>
      </div>

      <textarea
        placeholder="Описание"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <input
        type="date"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
      />

      {error && <p className={styles.error}>{error}</p>}

      <button type="submit" className={styles.submit}>
        Добавить задание
      </button>
    </form>
  )
}

export default AssignmentForm