import { useState, type FormEvent } from 'react'
import styles from './AssignmentForm.module.css'
import type { Assignment } from '../../types'

interface AssignmentFormProps {
  onAdd: (assignment: Assignment) => void
}

function AssignmentForm({ onAdd }: AssignmentFormProps) {
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (title.trim() === '' || subject.trim() === '' || deadline === '') {
      setError('Заполните название, предмет и срок сдачи')
      return
    }

    onAdd({
      id: String(Date.now()),
      title: title.trim(),
      subject: subject.trim(),
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
      <input
        type="text"
        placeholder="Предмет"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
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