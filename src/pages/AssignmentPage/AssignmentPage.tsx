import { useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import styles from './AssignmentPage.module.css'
import type { Account, Assignment, User, StudentHomework } from '../../types'
import * as api from '../../services/api'
import { hasSubject, normalize } from '../../utils/subjects'

interface FileEntry {
  id: string
  name: string
  file: File
}

interface PageProps {
  items: Assignment[]
  accounts: Account[]
  onUpdate: (id: Assignment['id'], changes: Partial<Assignment>) => void
  onSubmitStudentHomework?: (assignmentId: number) => Promise<void> | void
}

function AssignmentPage({ items, accounts, onUpdate, onSubmitStudentHomework }: PageProps) {
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
  onUpdate: (id: Assignment['id'], changes: Partial<Assignment> & {
    files?: File[]
    homework?: { description: string; files?: File[] }
  }) => void
  onSubmitStudentHomework?: (assignmentId: number) => Promise<void> | void
}

function AssignmentDetails({ assignment, user, onUpdate, onSubmitStudentHomework }: DetailsProps) {
  const canEdit = user.role === 'teacher'

  const [isEditing, setIsEditing] = useState(false)
  const [recordingUrl, setRecordingUrl] = useState(assignment.recording_url ?? '')
  const [description, setDescription] = useState(assignment.description ?? '')
  const [files, setFiles] = useState<FileEntry[]>([])

  const [isEditingHomework, setIsEditingHomework] = useState(false)
  const [homeworkDescription, setHomeworkDescription] = useState(assignment.homework?.description ?? '')
  const [homeworkFiles, setHomeworkFiles] = useState<FileEntry[]>([])

  // Форма отправки ответа учеником
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [studentDescription, setStudentDescription] = useState('')
  const [studentFiles, setStudentFiles] = useState<FileEntry[]>([])
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState(false)

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).map((file) => ({
      id: String(Date.now()) + Math.random().toString(36).slice(2),
      name: file.name,
      file,
    }))
    setFiles((prev) => [...prev, ...picked])
    e.target.value = ''
  }

  function handleRemoveFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function handleHomeworkFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).map((file) => ({
      id: String(Date.now()) + Math.random().toString(36).slice(2),
      name: file.name,
      file,
    }))
    setHomeworkFiles((prev) => [...prev, ...picked])
    e.target.value = ''
  }

  function handleRemoveHomeworkFile(id: string) {
    setHomeworkFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function handleStudentFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).map((file) => ({
      id: String(Date.now()) + Math.random().toString(36).slice(2),
      name: file.name,
      file,
    }))
    setStudentFiles((prev) => [...prev, ...picked])
    e.target.value = ''
  }

  function handleRemoveStudentFile(id: string) {
    setStudentFiles((prev) => prev.filter((f) => f.id !== id))
  }

  async function handleSubmitAnswer() {
    if (!assignment.id) return
    if (!user) return

    // Находим аккаунт ученика по имени
    const account = accounts.find((a) => normalize(a.name) === normalize(user.name))
    if (!account?.id) {
      setSubmitError('Аккаунт ученика не найден')
      return
    }

    setIsSubmitting(true)
    setSubmitError('')
    setSubmitSuccess(false)

    try {
      await api.submitStudentHomework({
        assignmentId: assignment.id,
        studentId: account.id,
        description: studentDescription,
        files: studentFiles.map((f) => f.file),
      })
      setStudentDescription('')
      setStudentFiles([])
      setSubmitSuccess(true)
      // Перезагружаем данные задания, чтобы ответы отображались
      if (onSubmitStudentHomework) {
        await onSubmitStudentHomework(assignment.id)
      }
      setTimeout(() => setSubmitSuccess(false), 3000)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Ошибка при отправке ответа')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleSave() {
    onUpdate(assignment.id!, {
      recording_url: recordingUrl,
      description,
      files: files.map((f) => f.file),
    })
    setFiles([])
    setIsEditing(false)
  }

  function handleCancel() {
    setRecordingUrl(assignment.recording_url ?? '')
    setDescription(assignment.description ?? '')
    setFiles([])
    setIsEditing(false)
  }

  function handleSaveHomework() {
    onUpdate(assignment.id!, {
      homework: {
        description: homeworkDescription,
        files: homeworkFiles.map((f) => f.file),
      },
    })
    setHomeworkFiles([])
    setIsEditingHomework(false)
  }

  function handleCancelHomework() {
    setHomeworkDescription(assignment.homework?.description ?? '')
    setHomeworkFiles([])
    setIsEditingHomework(false)
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

        <div className={styles.divider} />

        <section className={styles.section}>
          <h2>Домашнее задание</h2>
          {isEditingHomework ? (
            <div className={styles.editor}>
              <label className={styles.label}>
                Описание задания
                <textarea
                  className={styles.textarea}
                  rows={5}
                  placeholder="Опишите, что нужно сделать..."
                  value={homeworkDescription}
                  onChange={(e) => setHomeworkDescription(e.target.value)}
                />
              </label>

              <label className={styles.label}>
                Файлы с заданием
                <input type="file" multiple onChange={handleHomeworkFilesChange} />
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

              <div className={styles.actions}>
                <button type="button" className={styles.primary} onClick={handleSaveHomework}>
                  Сохранить
                </button>
                <button type="button" className={styles.secondary} onClick={handleCancelHomework}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <>
              {assignment.homework ? (
                <>
                  <p className={styles.homeworkDescription}>
                    {assignment.homework.description}
                  </p>
                  {assignment.homework.files && assignment.homework.files.length > 0 && (
                    <ul className={styles.files}>
                      {assignment.homework.files.map((f) => (
                        <li key={f.id}>
                          <a className={styles.link} href={f.url} download={f.name}>
                            📎 {f.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className={styles.empty}>Домашнее задание пока не добавлено</p>
              )}
              {canEdit && (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setIsEditingHomework(true)}
                >
                  {assignment.homework ? 'Редактировать задание' : 'Добавить задание'}
                </button>
              )}
            </>
          )}
        </section>

        {/* Секция "Ответы учеников" — только для учителей */}
        {user.role === 'teacher' && (
          <section className={styles.section}>
            <h2>Ответы учеников</h2>
            {assignment.student_homeworks && assignment.student_homeworks.length > 0 ? (
              <ul className={styles.studentHomeworks}>
                {assignment.student_homeworks.map((sh) => (
                  <li key={sh.id} className={styles.studentHomeworkCard}>
                    <div className={styles.studentHomeworkHeader}>
                      <span className={styles.studentName}>{sh.student_name}</span>
                      <span className={styles.submittedAt}>
                        {sh.submitted_at ? new Date(sh.submitted_at).toLocaleString('ru-RU') : ''}
                      </span>
                    </div>
                    {sh.description && (
                      <p className={styles.studentHomeworkDescription}>{sh.description}</p>
                    )}
                    {sh.files && sh.files.length > 0 && (
                      <ul className={styles.files}>
                        {sh.files.map((f) => (
                          <li key={f.id}>
                            <a className={styles.link} href={f.url} download={f.name}>
                              📎 {f.name}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Пока никто не отправил ответ</p>
            )}
          </section>
        )}

        {/* Секция "Отправить ответ ученику" — только для учеников */}
        {user.role === 'student' && (
          <section className={styles.section}>
            <h2>Отправить ответ</h2>
            {submitSuccess && <p className={styles.success}>Ответ успешно отправлен!</p>}
            {submitError && <p className={styles.error}>{submitError}</p>}
            <label className={styles.label}>
              Описание проделанной работы
              <textarea
                className={styles.textarea}
                rows={5}
                placeholder="Опишите, что вы сделали..."
                value={studentDescription}
                onChange={(e) => setStudentDescription(e.target.value)}
              />
            </label>
            <label className={styles.label}>
              Файлы с ответом
              <input type="file" multiple onChange={handleStudentFilesChange} />
            </label>
            {studentFiles.length > 0 && (
              <ul className={styles.files}>
                {studentFiles.map((f) => (
                  <li key={f.id}>
                    <span>{f.name}</span>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => handleRemoveStudentFile(f.id)}
                    >
                      Удалить
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={handleSubmitAnswer}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Отправка...' : 'Отправить ответ'}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export default AssignmentPage