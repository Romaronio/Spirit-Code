import { useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import styles from './AssignmentPage.module.css'
import type { Account, Assignment, LessonFile, User } from '../../types'
import { hasSubject, normalize } from '../../utils/subjects'

interface PageProps {
  items: Assignment[]
  accounts: Account[]
  onUpdate: (id: Assignment['id'], changes: Partial<Assignment>) => void
}

function AssignmentPage({ items, accounts, onUpdate }: PageProps) {
  const { id } = useParams()
  const location = useLocation()
  const user = location.state as User | null

  if (!user) {
    return <Navigate to="/" replace />
  }

  const found = items.find((item) => item.id === Number(id))

  // Ученик видит только задания по своим предметам
  const account = accounts.find((a) => normalize(a.name) === normalize(user.name))
  const allowed =
    found !== undefined &&
    (user.role === 'teacher' || hasSubject(account?.subjects, found.subject))
  const assignment = allowed ? found : undefined

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
  const [recordingUrl, setRecordingUrl] = useState(assignment.recording_url ?? '')
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

  function handleRemoveFile(fileId: number) {
    setFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  function handleSave() {
    onUpdate(assignment.id!, { recording_url: recordingUrl, description, files })
    setIsEditing(false)
  }

  function handleCancel() {
    setRecordingUrl(assignment.recording_url ?? '')
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
              {assignment.recording_url ? (
                <a
                  className={styles.link}
                  href={assignment.recording_url}
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