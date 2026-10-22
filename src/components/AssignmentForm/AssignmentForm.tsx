import { useState, type FormEvent, type ChangeEvent } from 'react'
import styles from './AssignmentForm.module.css'
import { ACCEPT, MAX_FILE_SIZE_MB, pickFiles, type FileEntry } from '../../utils/uploads'

interface AssignmentFormProps {
  onAdd: (data: {
    title: string
    subject: string
    deadline: string
    description?: string
    recording_url?: string
    homework?: { description: string }
    files?: File[]
    homework_files?: File[]
  }) => Promise<void> | void
}

const SUBJECTS = ['Математика', 'Информатика', 'Русский язык']

function AssignmentForm({ onAdd }: AssignmentFormProps) {
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [recordingUrl, setRecordingUrl] = useState('')
  const [error, setError] = useState('')

  const [files, setFiles] = useState<FileEntry[]>([])
  const [homeworkDescription, setHomeworkDescription] = useState('')
  const [homeworkFiles, setHomeworkFiles] = useState<FileEntry[]>([])

  function handleFilesChange(e: ChangeEvent<HTMLInputElement>) {
    const { entries, error } = pickFiles(e.target.files)
    setFiles((prev) => [...prev, ...entries])
    setError(error)
    e.target.value = ''
  }

  function handleRemoveFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function handleHomeworkFilesChange(e: ChangeEvent<HTMLInputElement>) {
    const { entries, error } = pickFiles(e.target.files)
    setHomeworkFiles((prev) => [...prev, ...entries])
    setError(error)
    e.target.value = ''
  }

  function handleRemoveHomeworkFile(id: string) {
    setHomeworkFiles((prev) => prev.filter((f) => f.id !== id))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (title.trim() === '' || subject === '' || deadline === '') {
      setError('Заполните название, предмет и срок сдачи')
      return
    }

    try {
      await onAdd({
        title: title.trim(),
        subject: subject,
        description: description.trim(),
        deadline,
        recording_url: recordingUrl.trim() || undefined,
        homework: homeworkDescription.trim() ? { description: homeworkDescription.trim() } : undefined,
        files: files.map((f) => f.file),
        homework_files: homeworkFiles.map((f) => f.file),
      })

      setTitle('')
      setSubject('')
      setDescription('')
      setDeadline('')
      setRecordingUrl('')
      setFiles([])
      setHomeworkDescription('')
      setHomeworkFiles([])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при создании задания')
    }
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
        placeholder="Описание урока"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <input
        type="date"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
      />

      <label className={styles.label}>
        Ссылка на запись урока
        <input
          type="url"
          placeholder="https://..."
          value={recordingUrl}
          onChange={(e) => setRecordingUrl(e.target.value)}
        />
      </label>

      <label className={styles.label}>
        Файлы с урока
        <input type="file" multiple accept={ACCEPT} onChange={handleFilesChange} />
      </label>
      {files.length > 0 && (
        <ul className={styles.files}>
          {files.map((f) => (
            <li key={f.id}>
              <span>{f.name}</span>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => handleRemoveFile(f.id)}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.divider} />

      <h3>Домашнее задание</h3>
      <label className={styles.label}>
        Описание ДЗ
        <textarea
          rows={4}
          placeholder="Опишите, что нужно сделать..."
          value={homeworkDescription}
          onChange={(e) => setHomeworkDescription(e.target.value)}
        />
      </label>

      <label className={styles.label}>
        Файлы с заданием
        <input type="file" multiple accept={ACCEPT} onChange={handleHomeworkFilesChange} />
      </label>
      {homeworkFiles.length > 0 && (
        <ul className={styles.files}>
          {homeworkFiles.map((f) => (
            <li key={f.id}>
              <span>{f.name}</span>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => handleRemoveHomeworkFile(f.id)}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.label}>Каждый файл — до {MAX_FILE_SIZE_MB} МБ</p>
      {error && <p className={styles.error}>{error}</p>}

      <button type="submit" className={styles.submit}>
        Добавить задание
      </button>
    </form>
  )
}

export default AssignmentForm