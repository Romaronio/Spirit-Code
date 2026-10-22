import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import styles from './AssignmentPage.module.css'
import * as api from '../../services/api'
import { hasSubject, normalize } from '../../utils/subjects'
import type { Account, Assignment, AssignmentChanges, ReviewStatus, User } from '../../types'
import { ReviewButtons, StatusBadge } from '../../components/AnswerStatus/AnswerStatus'
import { ACCEPT, MAX_FILE_SIZE_MB, pickFiles, type FileEntry } from '../../utils/uploads'

interface PageProps {
  user: User | null
  items: Assignment[]
  accounts: Account[]
  onUpdate: (id: Assignment['id'], changes: AssignmentChanges) => Promise<void>
  onSubmitStudentHomework?: (assignmentId: number) => Promise<void> | void
  onReview?: (assignmentId: number, answerId: number, status: ReviewStatus) => Promise<void>
  onOpen?: (assignmentId: number) => Promise<void> | void
}

function AssignmentPage({ user, items, accounts, onUpdate, onSubmitStudentHomework, onReview, onOpen }: PageProps) {
  const { id } = useParams()

  // При открытии подгружаем задание заново, чтобы ссылки на файлы были свежими
  useEffect(() => {
    if (user && id) onOpen?.(Number(id))
  }, [user, id, onOpen])

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

  return (
    <AssignmentDetails
      assignment={assignment}
      user={user}
      studentId={account?.id}
      onUpdate={onUpdate}
      onSubmitStudentHomework={onSubmitStudentHomework}
      onReview={onReview}
    />
  )
}

interface DetailsProps {
  assignment: Assignment
  user: User
  studentId?: number
  onUpdate: (id: Assignment['id'], changes: AssignmentChanges) => Promise<void>
  onSubmitStudentHomework?: (assignmentId: number) => Promise<void> | void
  onReview?: (assignmentId: number, answerId: number, status: ReviewStatus) => Promise<void>
}

function AssignmentDetails({ assignment, user, studentId, onUpdate, onSubmitStudentHomework, onReview }: DetailsProps) {
  const canEdit = user.role === 'teacher'

  const [isEditing, setIsEditing] = useState(false)
  const [recordingUrl, setRecordingUrl] = useState(assignment.recording_url ?? '')
  const [description, setDescription] = useState(assignment.description ?? '')
  const [files, setFiles] = useState<FileEntry[]>([])

  const [isEditingHomework, setIsEditingHomework] = useState(false)
  const [homeworkDescription, setHomeworkDescription] = useState(assignment.homework?.description ?? '')
  const [homeworkFiles, setHomeworkFiles] = useState<FileEntry[]>([])

  // Сохранение правок учителем: редактор закрываем только после успеха,
  // а при ошибке оставляем выбранные файлы и показываем сообщение
  const [isSaving, setIsSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [homeworkError, setHomeworkError] = useState('')

  // Форма отправки ответа учеником
  const [isSubmitting, setIsSubmitting] = useState(false)
  const myAnswer = assignment.student_homeworks?.find((sh) => sh.student === studentId)
  const [studentDescription, setStudentDescription] = useState(myAnswer?.description ?? '')
  const [studentFiles, setStudentFiles] = useState<FileEntry[]>([])
  const [deletedSavedFileIds, setDeletedSavedFileIds] = useState<Array<number | string>>([])
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState(false)

  // Сохранённые файлы ответа без тех, что ученик пометил на удаление
  const savedFiles = (myAnswer?.files ?? []).filter(
    (f) => f.id === undefined || !deletedSavedFileIds.includes(f.id)
  )

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { entries, error } = pickFiles(e.target.files)
    setFiles((prev) => [...prev, ...entries])
    setEditError(error)
    e.target.value = ''
  }

  function handleRemoveFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function handleHomeworkFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { entries, error } = pickFiles(e.target.files)
    setHomeworkFiles((prev) => [...prev, ...entries])
    setHomeworkError(error)
    e.target.value = ''
  }

  function handleRemoveHomeworkFile(id: string) {
    setHomeworkFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function handleStudentFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { entries, error } = pickFiles(e.target.files)
    setStudentFiles((prev) => [...prev, ...entries])
    setSubmitError(error)
    e.target.value = ''
  }

  function handleRemoveStudentFile(id: string) {
    setStudentFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function handleRemoveSavedFile(id: number | string | undefined) {
    if (id === undefined) return
    setDeletedSavedFileIds((prev) => [...prev, id])
  }

  async function handleSubmitAnswer() {
    if (!assignment.id) return
    if (!studentId) {
      setSubmitError('Аккаунт ученика не найден')
      return
    }

    setIsSubmitting(true)
    setSubmitError('')
    setSubmitSuccess(false)

    try {
      await api.submitStudentHomework({
        assignmentId: assignment.id,
        description: studentDescription,
        files: studentFiles.map((f) => f.file),
        deleteFileIds: deletedSavedFileIds,
      })
      // Перезагружаем задание, чтобы сохранённый ответ подтянулся с сервера
      if (onSubmitStudentHomework) {
        await onSubmitStudentHomework(assignment.id)
      }
      setStudentFiles([])
      setDeletedSavedFileIds([])
      setSubmitSuccess(true)
      setTimeout(() => setSubmitSuccess(false), 3000)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Ошибка при отправке ответа')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSave() {
    setIsSaving(true)
    setEditError('')
    try {
      await onUpdate(assignment.id!, {
        recording_url: recordingUrl,
        description,
        files: files.map((f) => f.file),
      })
      setFiles([])
      setIsEditing(false)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Не удалось сохранить изменения')
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancel() {
    setRecordingUrl(assignment.recording_url ?? '')
    setDescription(assignment.description ?? '')
    setFiles([])
    setEditError('')
    setIsEditing(false)
  }

  async function handleSaveHomework() {
    setIsSaving(true)
    setHomeworkError('')
    try {
      await onUpdate(assignment.id!, {
        homework: {
          description: homeworkDescription,
          files: homeworkFiles.map((f) => f.file),
        },
      })
      setHomeworkFiles([])
      setIsEditingHomework(false)
    } catch (err) {
      setHomeworkError(err instanceof Error ? err.message : 'Не удалось сохранить домашнее задание')
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancelHomework() {
    setHomeworkDescription(assignment.homework?.description ?? '')
    setHomeworkFiles([])
    setHomeworkError('')
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

            {editError && <p className={styles.error}>{editError}</p>}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={handleCancel}
                disabled={isSaving}
              >
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

              {homeworkError && <p className={styles.error}>{homeworkError}</p>}

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={handleSaveHomework}
                  disabled={isSaving}
                >
                  {isSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={handleCancelHomework}
                  disabled={isSaving}
                >
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
                      <span className={styles.studentName}>
                        {sh.student_name} <StatusBadge status={sh.status} />
                      </span>
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
                    {onReview && (
                      <ReviewButtons
                        status={sh.status}
                        onChange={(value) => onReview(assignment.id!, sh.id!, value)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Пока никто не отправил ответ</p>
            )}
          </section>
        )}

        {/* Секция "Отправить ответ" — только для учеников */}
        {user.role === 'student' && (
          <section className={styles.section}>
            <h2>Отправить ответ</h2>
            {myAnswer && (
              <p className={styles.reviewStatus}>
                Статус: <StatusBadge status={myAnswer.status} />
                {myAnswer.status === 'rejected' && ' — исправьте ответ и отправьте снова'}
              </p>
            )}
            {submitSuccess && <p className={styles.success}>Ответ сохранён!</p>}
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
              Файлы с ответом (каждый — до {MAX_FILE_SIZE_MB} МБ)
              <input type="file" multiple accept={ACCEPT} onChange={handleStudentFilesChange} />
            </label>
            {savedFiles.length > 0 && (
              <ul className={styles.files}>
                {savedFiles.map((f) => (
                  <li key={f.id}>
                    <a className={styles.link} href={f.url} download={f.name}>
                      📎 {f.name}
                    </a>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => handleRemoveSavedFile(f.id)}
                    >
                      Удалить
                    </button>
                  </li>
                ))}
              </ul>
            )}
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