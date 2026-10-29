import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import styles from './AssignmentPage.module.css'
import * as api from '../../services/api'
import { hasSubject, normalize } from '../../utils/subjects'
import type { Account, Assignment, AssignmentChanges, CommentActions, NumberedTask, ReviewStatus, User } from '../../types'
import { ReviewButtons, StatusBadge } from '../../components/AnswerStatus/AnswerStatus'
import CommentThread from '../../components/CommentThread/CommentThread'
import { ACCEPT, EMPTY_TASK_FILES, MAX_FILE_SIZE_MB, pickFiles, taskFileChanges, type FileEntry, type TaskFilesDraft } from '../../utils/uploads'
import { taskNumberTitle } from '../../utils/taskNumbers'
import { parseLatex } from '../../utils/latex'
import LatexEditor from '../../components/LatexEditor/LatexEditor'
import NumberedTasksEditor from '../../components/NumberedTasksEditor/NumberedTasksEditor'
import TasksViewer from '../../components/TasksViewer/TasksViewer'

interface PageProps {
  user: User | null
  items: Assignment[]
  accounts: Account[]
  onUpdate: (id: Assignment['id'], changes: AssignmentChanges) => Promise<void>
  onSubmitStudentHomework?: (assignmentId: number) => Promise<void> | void
  onReview?: (assignmentId: number, answerId: number, status: ReviewStatus) => Promise<void>
  commentActions?: CommentActions
  onOpen?: (assignmentId: number) => Promise<void> | void
}

function AssignmentPage({ user, items, accounts, onUpdate, onSubmitStudentHomework, onReview, commentActions, onOpen }: PageProps) {
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
      commentActions={commentActions}
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
  commentActions?: CommentActions
}

function AssignmentDetails({ assignment, user, studentId, onUpdate, onSubmitStudentHomework, onReview, commentActions }: DetailsProps) {
  const canEdit = user.role === 'teacher'

  const [isEditing, setIsEditing] = useState(false)
  const [recordingUrl, setRecordingUrl] = useState(assignment.recording_url ?? '')
  const [description, setDescription] = useState(assignment.description ?? '')
  const [numberedTasks, setNumberedTasks] = useState<NumberedTask[]>(assignment.numbered_tasks ?? [])
  const [tasksLatex, setTasksLatex] = useState(assignment.tasks_latex ?? '')
  const [taskFiles, setTaskFiles] = useState<TaskFilesDraft>(EMPTY_TASK_FILES)

  const [isEditingHomework, setIsEditingHomework] = useState(false)
  const [homeworkDescription, setHomeworkDescription] = useState(assignment.homework?.description ?? '')
  const [homeworkTasks, setHomeworkTasks] = useState<NumberedTask[]>(assignment.homework?.numbered_tasks ?? [])
  const [homeworkLatex, setHomeworkLatex] = useState(assignment.homework?.tasks_latex ?? '')
  const [homeworkFiles, setHomeworkFiles] = useState<FileEntry[]>([])
  const [homeworkTaskFiles, setHomeworkTaskFiles] = useState<TaskFilesDraft>(EMPTY_TASK_FILES)

  // Сохранение правок учителем: редактор закрываем только после успеха,
  // а при ошибке оставляем выбранные файлы и показываем сообщение
  const [isSaving, setIsSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [homeworkError, setHomeworkError] = useState('')

  // Какие задания открыты в панели: по номеру, классной работы без номера или домашние
  // Номера ДЗ — ключи вида 'hw-5', чтобы не путать с номерами классной работы
  const [openTasks, setOpenTasks] = useState<number | 'classwork' | 'homework' | `hw-${number}` | null>(null)
  // Номер виден ученику, если у него есть LaTeX или файлы для выполнения
  const lessonFiles = assignment.files ?? []
  const homeworkFilesSaved = assignment.homework?.files ?? []
  const isShown = (t: NumberedTask, files: { task_number?: number | null }[]) =>
    t.latex.trim() !== '' || files.some((f) => f.task_number === t.number)
  const openNumbered = assignment.numbered_tasks?.find((t) => t.number === openTasks && isShown(t, lessonFiles))
  const shownNumbered = (assignment.numbered_tasks ?? []).filter((t) => isShown(t, lessonFiles))
  // Пустые номера ученик не видит — учителю показываем их отдельно, чтобы не потерялись
  const emptyNumbers = (assignment.numbered_tasks ?? []).filter((t) => !isShown(t, lessonFiles)).map((t) => t.number)
  const openHomeworkNumbered = assignment.homework?.numbered_tasks?.find((t) => openTasks === `hw-${t.number}` && isShown(t, homeworkFilesSaved))
  const shownHomeworkNumbered = (assignment.homework?.numbered_tasks ?? []).filter((t) => isShown(t, homeworkFilesSaved))
  // Общие файлы — без файлов к номерам: те ученик скачивает в окне номера
  const commonLessonFiles = lessonFiles.filter((f) => f.task_number == null)
  const commonHomeworkFiles = homeworkFilesSaved.filter((f) => f.task_number == null)
  const closeTasks = useCallback(() => setOpenTasks(null), [])

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
        numbered_tasks: numberedTasks,
        tasks_latex: tasksLatex,
        ...taskFileChanges(taskFiles, numberedTasks.map((t) => t.number)),
      })
      setTaskFiles(EMPTY_TASK_FILES)
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
    setNumberedTasks(assignment.numbered_tasks ?? [])
    setTasksLatex(assignment.tasks_latex ?? '')
    setTaskFiles(EMPTY_TASK_FILES)
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
          numbered_tasks: homeworkTasks,
          tasks_latex: homeworkLatex,
          files: homeworkFiles.map((f) => f.file),
          ...taskFileChanges(homeworkTaskFiles, homeworkTasks.map((t) => t.number)),
        },
      })
      setHomeworkFiles([])
      setHomeworkTaskFiles(EMPTY_TASK_FILES)
      setIsEditingHomework(false)
    } catch (err) {
      setHomeworkError(err instanceof Error ? err.message : 'Не удалось сохранить домашнее задание')
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancelHomework() {
    setHomeworkDescription(assignment.homework?.description ?? '')
    setHomeworkTasks(assignment.homework?.numbered_tasks ?? [])
    setHomeworkLatex(assignment.homework?.tasks_latex ?? '')
    setHomeworkFiles([])
    setHomeworkTaskFiles(EMPTY_TASK_FILES)
    setHomeworkError('')
    setIsEditingHomework(false)
  }


  return (
    <div className={styles.page}>
      <Link to="/home" state={user} className={styles.back}>← Ко всем заданиям</Link>

      <div className={styles.layout}>
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

              <NumberedTasksEditor
                value={numberedTasks}
                onChange={setNumberedTasks}
                files={assignment.files}
                inputClassName={styles.input}
                taskFiles={taskFiles}
                onTaskFilesChange={setTaskFiles}
              />

              {(numberedTasks.length === 0 || tasksLatex.trim()) && (
                <LatexEditor
                  label={numberedTasks.length ? 'Задания без номера (LaTeX)' : 'Задания классной работы (LaTeX)'}
                  value={tasksLatex}
                  onChange={setTasksLatex}
                  files={assignment.files}
                />
              )}

              {/* Старые общие файлы урока: новые не прикрепляются, но эти можно убрать */}
              {commonLessonFiles.some((f) => f.id !== undefined && !taskFiles.removed.includes(f.id)) && (
                <>
                  <span className={styles.label}>Файлы с урока</span>
                  <ul className={styles.files}>
                    {commonLessonFiles
                      .filter((f) => f.id !== undefined && !taskFiles.removed.includes(f.id))
                      .map((f) => (
                        <li key={f.id}>
                          <a className={styles.link} href={f.url} download={f.name}>
                            📎 {f.name}
                          </a>
                          <button
                            type="button"
                            className={styles.linkButton}
                            onClick={() => setTaskFiles({ ...taskFiles, removed: [...taskFiles.removed, f.id!] })}
                          >
                            Удалить
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
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

              {(shownNumbered.length > 0 || assignment.tasks_latex?.trim() || (canEdit && emptyNumbers.length > 0)) && (
                <section className={styles.section}>
                  {canEdit && emptyNumbers.length > 0 && (
                    <p className={styles.empty}>
                      Пустые номера (ученик их не видит): {emptyNumbers.map(taskNumberTitle).join(', ')}
                    </p>
                  )}
                  {/* Ученик видит номера классной работы в выпадающем списке «Задания» */}
                  <TasksMenu title="Задания класс" collapsible={!canEdit}>
                    {shownNumbered.map((t) => (
                      <OpenTasksButton
                        key={t.number}
                        title={taskNumberTitle(t.number)}
                        source={t.latex}
                        isOpen={openTasks === t.number}
                        onOpen={() => setOpenTasks(t.number)}
                      />
                    ))}
                    {assignment.tasks_latex?.trim() && (
                      <OpenTasksButton
                        title={shownNumbered.length ? 'Другие задания' : 'Задания'}
                        source={assignment.tasks_latex}
                        isOpen={openTasks === 'classwork'}
                        onOpen={() => setOpenTasks('classwork')}
                      />
                    )}
                  </TasksMenu>
                </section>
              )}

              {commonLessonFiles.length > 0 && (
                <section className={styles.section}>
                  <h2>Файлы с урока</h2>
                  <ul className={styles.files}>
                    {commonLessonFiles.map((f) => (
                      <li key={f.id}>
                        <a className={styles.link} href={f.url} download={f.name}>
                          📎 {f.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

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

                <NumberedTasksEditor
                  value={homeworkTasks}
                  onChange={setHomeworkTasks}
                  files={assignment.homework?.files}
                  pendingNames={homeworkFiles.map((f) => f.name)}
                  taskFiles={homeworkTaskFiles}
                  onTaskFilesChange={setHomeworkTaskFiles}
                />

                {(homeworkTasks.length === 0 || homeworkLatex.trim()) && (
                  <LatexEditor
                    label={homeworkTasks.length ? 'Задания без номера (LaTeX)' : 'Задания в LaTeX'}
                    value={homeworkLatex}
                    onChange={setHomeworkLatex}
                    files={assignment.homework?.files}
                    pendingNames={homeworkFiles.map((f) => f.name)}
                  />
                )}

                <span className={styles.label}>Файлы с заданием</span>
                <label className={styles.fileButton}>
                  📎 Прикрепить файлы
                  <input type="file" multiple accept={ACCEPT} className={styles.hiddenInput} onChange={handleHomeworkFilesChange} />
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
                    {assignment.homework.description && (
                      <p className={styles.homeworkDescription}>
                        {assignment.homework.description}
                      </p>
                    )}
                    {(shownHomeworkNumbered.length > 0 || assignment.homework.tasks_latex?.trim()) && (
                      <TasksMenu title="Задания дз" collapsible={!canEdit}>
                        {shownHomeworkNumbered.map((t) => (
                          <OpenTasksButton
                            key={t.number}
                            title={taskNumberTitle(t.number)}
                            source={t.latex}
                            isOpen={openTasks === `hw-${t.number}`}
                            onOpen={() => setOpenTasks(`hw-${t.number}`)}
                          />
                        ))}
                        {assignment.homework.tasks_latex?.trim() && (
                          <OpenTasksButton
                            title={shownHomeworkNumbered.length ? 'Другие задания' : 'Домашнее задание'}
                            source={assignment.homework.tasks_latex}
                            isOpen={openTasks === 'homework'}
                            onOpen={() => setOpenTasks('homework')}
                          />
                        )}
                      </TasksMenu>
                    )}
                    {commonHomeworkFiles.length > 0 && (
                      <ul className={styles.files}>
                        {commonHomeworkFiles.map((f) => (
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
                      {commentActions && (
                        <CommentThread
                          comments={sh.comments}
                          currentUserId={user.id}
                          canDeleteAll
                          placeholder="Ответить ученику..."
                          onSend={(text) => commentActions.add(assignment.id!, sh.id!, text)}
                          onEdit={(id, text) => commentActions.edit(assignment.id!, sh.id!, id, text)}
                          onDelete={(id) => commentActions.remove(assignment.id!, sh.id!, id)}
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
              {myAnswer && commentActions && (
                <div className={styles.conversation}>
                  <p className={styles.label}>Переписка с учителем</p>
                  <CommentThread
                    comments={myAnswer.comments}
                    currentUserId={user.id ?? studentId}
                    placeholder="Написать учителю..."
                    onSend={(text) => commentActions.add(assignment.id!, myAnswer.id!, text)}
                    onEdit={(id, text) => commentActions.edit(assignment.id!, myAnswer.id!, id, text)}
                    onDelete={(id) => commentActions.remove(assignment.id!, myAnswer.id!, id)}
                  />
                </div>
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
              <span className={styles.label}>Файлы с ответом (каждый — до {MAX_FILE_SIZE_MB} МБ)</span>
              <label className={styles.fileButton}>
                📎 Прикрепить файлы
                <input type="file" multiple accept={ACCEPT} className={styles.hiddenInput} onChange={handleStudentFilesChange} />
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

        {openNumbered && (
          <TasksViewer
            title={`${assignment.title} · ${taskNumberTitle(openNumbered.number)}`}
            subtitle={`${assignment.subject} · классная работа`}
            source={openNumbered.latex}
            files={assignment.files}
            attachments={lessonFiles.filter((f) => f.task_number === openNumbered.number)}
            answer={canEdit ? openNumbered.answer : undefined}
            onClose={closeTasks}
          />
        )}
        {openTasks === 'classwork' && assignment.tasks_latex && (
          <TasksViewer
            title={assignment.title}
            subtitle={`${assignment.subject} · классная работа`}
            source={assignment.tasks_latex}
            files={assignment.files}
            onClose={closeTasks}
          />
        )}
        {openHomeworkNumbered && (
          <TasksViewer
            title={`${assignment.title} · ${taskNumberTitle(openHomeworkNumbered.number)}`}
            subtitle={`${assignment.subject} · домашнее задание, сдать до ${assignment.deadline}`}
            source={openHomeworkNumbered.latex}
            files={assignment.homework?.files}
            attachments={homeworkFilesSaved.filter((f) => f.task_number === openHomeworkNumbered.number)}
            answer={canEdit ? openHomeworkNumbered.answer : undefined}
            onClose={closeTasks}
          />
        )}
        {openTasks === 'homework' && assignment.homework?.tasks_latex && (
          <TasksViewer
            title={assignment.title}
            subtitle={`${assignment.subject} · домашнее задание, сдать до ${assignment.deadline}`}
            source={assignment.homework.tasks_latex}
            files={assignment.homework.files}
            onClose={closeTasks}
          />
        )}
      </div>
    </div>
  )
}

// Кнопка «N задание» с числом задач в документе
function OpenTasksButton({ title, source, isOpen, onOpen }: { title: string; source: string; isOpen: boolean; onOpen: () => void }) {
  const tasks = useMemo(() => parseLatex(source).tasks, [source])
  return (
    <button
      type="button"
      className={`${styles.openTasks} ${isOpen ? styles.openTasksActive : ''}`}
      aria-pressed={isOpen}
      onClick={onOpen}
    >
      <span className={styles.openTasksIcon}>📄</span>
      <span>
        <span className={styles.openTasksTitle}>{title}</span>
        {tasks > 0 && <span className={styles.openTasksCount}>{tasksCount(tasks)}</span>}
      </span>
    </button>
  )
}

// Выпадающий список «Задания»: у ученика кнопки заданий скрыты, пока список не раскрыт,
// у учителя (collapsible=false) показываются сразу
function TasksMenu({ title, collapsible, children }: { title: string; collapsible: boolean; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  if (!collapsible) return <div className={styles.openTasksList}>{children}</div>
  return (
    <>
      <button
        type="button"
        className={`${styles.openTasks} ${isOpen ? styles.openTasksActive : ''}`}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((v) => !v)}
      >
        <TasksIcon />
        <span className={styles.openTasksTitle}>{title}</span>
        <span className={styles.tasksMenuArrow}>{isOpen ? '▴' : '▾'}</span>
      </button>
      {isOpen && <div className={`${styles.openTasksList} ${styles.tasksMenu}`}>{children}</div>}
    </>
  )
}

// Иконка в стиле платформы: оранжевая плашка со списком задач
function TasksIcon() {
  return (
    <svg className={styles.tasksIcon} width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#ff8400" />
      <g stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M8 10.5l1.6 1.6L12.5 9" />
        <path d="M8 16.5l1.6 1.6 2.9-3.1" />
        <path d="M8 22.5l1.6 1.6 2.9-3.1" />
        <path d="M16 11h8M16 17h8M16 23h5" />
      </g>
    </svg>
  )
}

function tasksCount(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  const word = mod10 === 1 && mod100 !== 11 ? 'задача' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'задачи' : 'задач'
  return `${n} ${word}`
}

export default AssignmentPage