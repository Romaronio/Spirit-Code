import { useState } from 'react'
import type { Assignment, LessonFile } from '../../types'
import styles from './AssignmentForm.module.css'

interface Props {
  assignment: Assignment
  canEdit: boolean
  onUpdate: (id: Assignment['id'], changes: Partial<Assignment>) => void
}

function AssignmentCard({ assignment, canEdit, onUpdate }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [recordingUrl, setRecordingUrl] = useState(assignment.recordingUrl ?? '')
  const [description, setDescription] = useState(assignment.description ?? '')
  const [files, setFiles] = useState<LessonFile[]>(assignment.files ?? [])

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      url: URL.createObjectURL(file),
    }))
    setFiles((prev) => [...prev, ...picked])
    e.target.value = '' // чтобы можно было выбрать тот же файл ещё раз
  }

  function handleRemoveFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id))
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

  return (
    <div className={styles.card}>
      {/* ...твоя текущая разметка карточки (название, дата и т.д.) */}

      {isEditing ? (
        <div className={styles.editor}>
          <input className={styles.input}
            type="url"
            placeholder="Ссылка на запись урока"
            value={recordingUrl}
            onChange={(e) => setRecordingUrl(e.target.value)}
          />

          <textarea className={styles.textarea}
            placeholder="Описание урока"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <input type="file" multiple onChange={handleFilesChange} />

          <ul>
            {files.map((f) => (
              <li key={f.id}>
                {f.name}
                <button type="button" onClick={() => handleRemoveFile(f.id)}>
                  Удалить
                </button>
              </li>
            ))}
          </ul>

          <button type="button" onClick={handleSave}>Сохранить</button>
          <button type="button" onClick={handleCancel}>Отмена</button>
        </div>
      ) : (
        <div className={styles.materials}>
          {assignment.description && <p>{assignment.description}</p>}

          {assignment.recordingUrl && (
            <a href={assignment.recordingUrl} target="_blank" rel="noreferrer">
              Запись урока
            </a>
          )}

          {assignment.files && assignment.files.length > 0 && (
            <ul>
              {assignment.files.map((f) => (
                <li key={f.id}>
                  <a href={f.url} download={f.name}>{f.name}</a>
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <button type="button" onClick={() => setIsEditing(true)}>
              Редактировать материалы
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default AssignmentCard