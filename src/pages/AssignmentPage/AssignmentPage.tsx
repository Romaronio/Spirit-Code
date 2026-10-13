import { useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import styles from './AssignmentPage.module.css'
import type { Assignment, LessonFile, User } from '../../types'

interface PageProps {
  items: Assignment[]
  onUpdate: (id: Assignment['id'], changes: Partial<Assignment>) => void
}

function AssignmentPage({ items, onUpdate }: PageProps) {
  const { id } = useParams()
  const location = useLocation()
  const user = location.state as User | null

  if (!user) {
    return <Navigate to="/" replace />
  }

  const assignment = items.find((item) => item.id === id)

  if (!assignment) {
    return (
      <div className={styles.page}>
        <Link to="/home" state={user} className={styles.back}>← Ко всем заданиям</Link>
        <p>Задание не найдено</p>
      </div>
    )
  }

  return <AssignmentDetails assignment={assignment} user={user} onUpdate={onUpdate} />
}

interface DetailsProps {
  assignment: Assignment
  user: User
  onUpdate: (id: Assignment['id'], changes: Partial<Assignment>) => void
}

function AssignmentDetails({ assignment, user, onUpdate }: DetailsProps) {
  const canEdit = user.role === 'teacher'

  const [isEditing, setIsEditing] = useState(false)
  const [recordingUrl, setRecordingUrl] = useState(assignment.recordingUrl ?? '')
  const [description, setDescription] = useState(assignment.description ?? '')
  const [files, setFiles] = useState<LessonFile[]>(assignment.files ?? [])

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).map((file) => ({
      id: String(Date.now()) + Math.random().toString(36).slice(2),
      name: file.name,
      url: URL.createObjectURL(file),
    }))
    setFiles((prev) => [...prev, ...picked])
    e.target.value = ''
  }

  function handleRemoveFile(fileId: string) {
    setFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  function handleSave() {
    onUpdate(assignment.id, { recordingUrl, description, files })
    setIsEditing(false)
  }

  function handleCancel() {
    setRecordingUrl(assignment.recordingUrl ?? '')
    setDescription(assignment.description ?? '')
    setFiles(assignment.files ?? [])
    setIsEditing(false)
  }

  const hasFiles = assignment.files && assignment.files.length > 0

  return (
    <div className={styles.page}>
      <Link to="/home" state={user} className={styles.back}>← Ко всем заданиям</Link>

      <div className={styles.card}>
        <span className={styles.subject}>{assignment.subject}</span>
        <h1 className={styles.title}>{assignment.title}</h1>
        <p className={styles.deadline}>Сдать до: {assignment.deadline}</p>

        {isEditing ? (
          <div className={styles.editor}>
            <label className={styles.label}>
              Ссылка на запись урока
              <input
                className={styles.input}
                type="url"
                placeholder="https://..."
                value={recordingUrl}
                onChange={(e) => setRecordingUrl(e.target.value)}
              />
            </label>

            <label className={styles.label}>
              Описание
              <textarea
                className={styles.textarea}
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            <label className={styles.label}>
              Файлы с урока
              <input type="file" multiple onChange={handleFilesChange} />
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

            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={handleSave}>
                Сохранить
              </button>
              <button type="button" className={styles.secondary} onClick={handleCancel}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <>
            <section className={styles.section}>
              <h2>Описание</h2>
              {assignment.description ? (
                <p>{assignment.description}</p>
              ) : (
                <p className={styles.empty}>Описание пока не добавлено</p>
              )}
            </section>

            <section className={styles.section}>
              <h2>Запись урока</h2>
              {assignment.recordingUrl ? (
                <a
                  className={styles.link}
                  href={assignment.recordingUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  ▶ Смотреть запись
                </a>
              ) : (
                <p className={styles.empty}>Ссылка пока не добавлена</p>
              )}
            </section>

            <section className={styles.section}>
              <h2>Файлы с урока</h2>
              {hasFiles ? (
                <ul className={styles.files}>
                  {assignment.files!.map((f) => (
                    <li key={f.id}>
                      <a className={styles.link} href={f.url} download={f.name}>
                        📎 {f.name}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>Файлов пока нет</p>
              )}
            </section>

            {canEdit && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setIsEditing(true)}
              >
                Редактировать материалы
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default AssignmentPage