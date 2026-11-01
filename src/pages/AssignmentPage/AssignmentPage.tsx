import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import styles from './AssignmentPage.module.css'
import * as api from '../../services/api'
import { hasSubject, normalize } from '../../utils/subjects'
import type { Account, Assignment, AssignmentChanges, CommentActions, NumberedTask, ReviewStatus, StudentHomework, User } from '../../types'
import { ReviewButtons, StatusBadge } from '../../components/AnswerStatus/AnswerStatus'
import CommentThread from '../../components/CommentThread/CommentThread'
import { ACCEPT, EMPTY_TASK_FILES, pickFiles, taskFileChanges, type FileEntry, type TaskFilesDraft } from '../../utils/uploads'
import { taskNumberTitle } from '../../utils/taskNumbers'
import LatexEditor from '../../components/LatexEditor/LatexEditor'
import NumberedTasksEditor from '../../components/NumberedTasksEditor/NumberedTasksEditor'
import TasksViewer from '../../components/TasksViewer/TasksViewer'

// Что открыто в панели заданий: номер классной работы, задания без номера или номер ДЗ ('hw-5')
type TasksKey = number | 'classwork' | 'homework' | `hw-${number}`

// Ключ задания в ответе ученика (StudentHomework.task_answers): номер классной работы — 'cw-5'
function answerKey(key: TasksKey): string {
  return typeof key === 'number' ? `cw-${key}` : key
}

// Подпись задания в ответах учеников у учителя
function answerKeyTitle(key: string): string {
  const m = /^(cw|hw)-(\d+)$/.exec(key)
  if (m) return `${taskNumberTitle(Number(m[2]))} (${m[1] === 'cw' ? 'класс' : 'дз'})`
  return key === 'homework' ? 'Задания дз' : 'Задания класс'
}

// Есть ли у ученика ответ к заданию: текст или файлы
function hasTaskAnswer(sh: StudentHomework | undefined, key: string) {
  return Boolean(sh?.task_answers?.[key]?.trim() || sh?.files?.some((f) => f.task_key === key))
}

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
  const [openTasks, setOpenTasks] = useState<TasksKey | null>(null)
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
  // Задания в том же порядке, что и кнопки в списках, — для кнопки «Следующее задание»
  const classworkOrder: TasksKey[] = [
    ...shownNumbered.map((t) => t.number),
    ...(assignment.tasks_latex?.trim() ? ['classwork' as const] : []),
  ]
  const homeworkOrder: TasksKey[] = [
    ...shownHomeworkNumbered.map((t) => `hw-${t.number}` as const),
    ...(assignment.homework?.tasks_latex?.trim() ? ['homework' as const] : []),
  ]
  const nextTasks = (() => {
    for (const order of [classworkOrder, homeworkOrder]) {
      const i = openTasks === null ? -1 : order.indexOf(openTasks)
      if (i !== -1) return order[i + 1]
    }
    return undefined
  })()
  const openNext = nextTasks === undefined ? undefined : () => setOpenTasks(nextTasks)

  // Форма отправки ответа учеником
  const [isSubmitting, setIsSubmitting] = useState(false)
  const myAnswer = assignment.student_homeworks?.find((sh) => sh.student === studentId)
  const [studentDescription, setStudentDescription] = useState(myAnswer?.description ?? '')
  const [deletedSavedFileIds, setDeletedSavedFileIds] = useState<Array<number | string>>([])
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState(false)

  // Сохранённые файлы ответа без тех, что ученик пометил на удаление
  const savedFiles = (myAnswer?.files ?? []).filter(
    (f) => !f.task_key && (f.id === undefined || !deletedSavedFileIds.includes(f.id))
  )

  // Порядок заданий в ответах учеников у учителя — как у кнопок заданий
  const answerOrder = [...classworkOrder, ...homeworkOrder].map(answerKey)
  // Верный ответ к номеру — учитель видит его рядом с ответом ученика
  const correctAnswer = (key: string) => {
    const m = /^(cw|hw)-(\d+)$/.exec(key)
    if (!m) return undefined
    const tasks = m[1] === 'cw' ? assignment.numbered_tasks : assignment.homework?.numbered_tasks
    return tasks?.find((t) => t.number === Number(m[2]))?.answer
  }

  async function handleSaveTaskAnswer(task: string, text: string, files: File[], deleteFileIds: Array<number | string>) {
    if (!assignment.id) return
    await api.submitTaskAnswer({ assignmentId: assignment.id, task, text, files, deleteFileIds })
    await onSubmitStudentHomework?.(assignment.id)
  }

  // Под открытым заданием: ученику — форма ответа, учителю — ответы учеников к этому заданию
  const answerBlock = (key: TasksKey) =>
    user.role === 'student' ? (
      <TaskAnswerForm key={answerKey(key)} answer={myAnswer} taskKey={answerKey(key)} onSave={handleSaveTaskAnswer} />
    ) : canEdit ? (
      <TaskAnswersList answers={assignment.student_homeworks ?? []} taskKey={answerKey(key)} />
    ) : null

  function handleHomeworkFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { entries, error } = pickFiles(e.target.files)
    setHomeworkFiles((prev) => [...prev, ...entries])
    setHomeworkError(error)
    e.target.value = ''
  }

  function handleRemoveHomeworkFile(id: string) {
    setHomeworkFiles((prev) => prev.filter((f) => f.id !== id))
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
        deleteFileIds: deletedSavedFileIds,
      })
      // Перезагружаем задание, чтобы сохранённый ответ подтянулся с сервера
      if (onSubmitStudentHomework) {
        await onSubmitStudentHomework(assignment.id)
      }
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
          {assignment.deadline && <p className={styles.deadline}>Сдать до: {assignment.deadline}</p>}

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
                        isOpen={openTasks === t.number}
                        answered={hasTaskAnswer(myAnswer, answerKey(t.number))}
                        onOpen={() => setOpenTasks(t.number)}
                      />
                    ))}
                    {assignment.tasks_latex?.trim() && (
                      <OpenTasksButton
                        title={shownNumbered.length ? 'Другие задания' : 'Задания'}
                        isOpen={openTasks === 'classwork'}
                        answered={hasTaskAnswer(myAnswer, 'classwork')}
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
                            isOpen={openTasks === `hw-${t.number}`}
                            answered={hasTaskAnswer(myAnswer, `hw-${t.number}`)}
                            onOpen={() => setOpenTasks(`hw-${t.number}`)}
                          />
                        ))}
                        {assignment.homework.tasks_latex?.trim() && (
                          <OpenTasksButton
                            title={shownHomeworkNumbered.length ? 'Другие задания' : 'Домашнее задание'}
                            isOpen={openTasks === 'homework'}
                            answered={hasTaskAnswer(myAnswer, 'homework')}
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
                      {answerOrder.some((key) => hasTaskAnswer(sh, key)) && (
                        <ul className={styles.taskAnswers}>
                          {answerOrder
                            .filter((key) => hasTaskAnswer(sh, key))
                            .map((key) => (
                              <li key={key}>
                                <span className={styles.taskAnswerTitle}>{answerKeyTitle(key)}</span>
                                {correctAnswer(key) && (
                                  <span className={styles.taskAnswerCorrect}> · верный ответ: {correctAnswer(key)}</span>
                                )}
                                <TaskAnswerContent answer={sh} taskKey={key} />
                              </li>
                            ))}
                        </ul>
                      )}
                      {sh.files?.some((f) => !f.task_key) && (
                        <ul className={styles.files}>
                          {sh.files.filter((f) => !f.task_key).map((f) => (
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
            <section className={`${styles.section} ${styles.answerForm}`}>
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
              {/* Новые файлы прикрепляются к заданиям; здесь только ранее отправленные — их можно убрать */}
              {savedFiles.length > 0 && <span className={styles.label}>Файлы с ответом</span>}
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
            taskNumber={openNumbered.number}
            onClose={closeTasks}
            onNext={openNext}
          >
            {answerBlock(openNumbered.number)}
          </TasksViewer>
        )}
        {openTasks === 'classwork' && assignment.tasks_latex && (
          <TasksViewer
            title={assignment.title}
            subtitle={`${assignment.subject} · классная работа`}
            source={assignment.tasks_latex}
            files={assignment.files}
            onClose={closeTasks}
            onNext={openNext}
          >
            {answerBlock('classwork')}
          </TasksViewer>
        )}
        {openHomeworkNumbered && (
          <TasksViewer
            title={`${assignment.title} · ${taskNumberTitle(openHomeworkNumbered.number)}`}
            subtitle={`${assignment.subject} · домашнее задание${assignment.deadline ? `, сдать до ${assignment.deadline}` : ''}`}
            source={openHomeworkNumbered.latex}
            files={assignment.homework?.files}
            attachments={homeworkFilesSaved.filter((f) => f.task_number === openHomeworkNumbered.number)}
            answer={canEdit ? openHomeworkNumbered.answer : undefined}
            taskNumber={openHomeworkNumbered.number}
            onClose={closeTasks}
            onNext={openNext}
          >
            {answerBlock(`hw-${openHomeworkNumbered.number}`)}
          </TasksViewer>
        )}
        {openTasks === 'homework' && assignment.homework?.tasks_latex && (
          <TasksViewer
            title={assignment.title}
            subtitle={`${assignment.subject} · домашнее задание${assignment.deadline ? `, сдать до ${assignment.deadline}` : ''}`}
            source={assignment.homework.tasks_latex}
            files={assignment.homework.files}
            onClose={closeTasks}
            onNext={openNext}
          >
            {answerBlock('homework')}
          </TasksViewer>
        )}
      </div>
    </div>
  )
}

// Кнопка задания: «N задание» или «Другие задания»
function OpenTasksButton({ title, isOpen, answered, onOpen }: { title: string; isOpen: boolean; answered?: boolean; onOpen: () => void }) {
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
        {answered && <span className={styles.openTasksAnswered}>✓ ответ прикреплён</span>}
      </span>
    </button>
  )
}

// Ответ ученика к одному заданию: текст и файлы
function TaskAnswerContent({ answer, taskKey }: { answer: StudentHomework; taskKey: string }) {
  const text = answer.task_answers?.[taskKey]
  const files = (answer.files ?? []).filter((f) => f.task_key === taskKey)
  return (
    <>
      {text && <p className={styles.studentHomeworkDescription}>{text}</p>}
      {files.length > 0 && (
        <ul className={styles.files}>
          {files.map((f) => (
            <li key={f.id}>
              <a className={styles.link} href={f.url} download={f.name}>
                📎 {f.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// Учителю под заданием — ответы всех учеников к нему
function TaskAnswersList({ answers, taskKey }: { answers: StudentHomework[]; taskKey: string }) {
  const answered = answers.filter((sh) => hasTaskAnswer(sh, taskKey))
  return (
    <section className={styles.taskAnswerBox}>
      <h3>Ответы учеников</h3>
      {answered.length > 0 ? (
        <ul className={styles.studentHomeworks}>
          {answered.map((sh) => (
            <li key={sh.id} className={styles.studentHomeworkCard}>
              <span className={styles.studentName}>
                {sh.student_name} <StatusBadge status={sh.status} />
              </span>
              <TaskAnswerContent answer={sh} taskKey={taskKey} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>Пока никто не прикрепил ответ к этому заданию</p>
      )}
    </section>
  )
}

interface TaskAnswerFormProps {
  answer?: StudentHomework
  taskKey: string
  onSave: (task: string, text: string, files: File[], deleteFileIds: Array<number | string>) => Promise<void>
}

// Пауза после ввода, после которой ответ сохраняется сам
const AUTOSAVE_DELAY_MS = 1000

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// Ученику под заданием — ответ к этому заданию: текст и файлы.
// Кнопки «Сохранить» нет: текст сохраняется после паузы в вводе, файлы — сразу
function TaskAnswerForm({ answer, taskKey, onSave }: TaskAnswerFormProps) {
  const [text, setText] = useState(answer?.task_answers?.[taskKey] ?? '')
  const [uploading, setUploading] = useState<FileEntry[]>([])
  const [deletedIds, setDeletedIds] = useState<Array<number | string>>([])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState('')

  // Текст, который уже в БД, и текущий — для сохранения при закрытии задания
  const savedTextRef = useRef(text)
  const textRef = useRef(text)
  const onSaveRef = useRef(onSave)
  // Сохранения идут строго по очереди, чтобы старый текст не перезаписал новый
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const save = useCallback(
    (files: File[] = [], deleteIds: Array<number | string> = []) => {
      const run = async () => {
        const current = textRef.current
        if (!files.length && !deleteIds.length && current === savedTextRef.current) return
        setSaveState('saving')
        try {
          await onSaveRef.current(taskKey, current, files, deleteIds)
          savedTextRef.current = current
          setSaveState('saved')
          setError('')
        } catch (err) {
          setSaveState('error')
          setError(err instanceof Error ? err.message : 'Не удалось сохранить ответ')
          throw err
        }
      }
      const next = queueRef.current.then(run)
      queueRef.current = next.catch(() => {})
      return next
    },
    [taskKey]
  )

  // Текст — после паузы в вводе
  useEffect(() => {
    if (text === savedTextRef.current) return
    const timer = setTimeout(() => save().catch(() => {}), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text, save])

  // Закрыли задание или перешли к следующему, не дождавшись паузы, — сохраняем сразу
  useEffect(() => () => void save().catch(() => {}), [save])

  const savedFiles = (answer?.files ?? []).filter(
    (f) => f.task_key === taskKey && (f.id === undefined || !deletedIds.includes(f.id))
  )

  function handleTextChange(value: string) {
    textRef.current = value
    setText(value)
  }

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { entries, error } = pickFiles(e.target.files)
    e.target.value = ''
    setError(error)
    if (!entries.length) return
    setUploading((prev) => [...prev, ...entries])
    try {
      await save(entries.map((f) => f.file))
    } catch {
      // сообщение об ошибке уже показано
    } finally {
      setUploading((prev) => prev.filter((f) => !entries.includes(f)))
    }
  }

  async function handleRemoveSaved(id: number | string | undefined) {
    if (id === undefined) return
    setDeletedIds((prev) => [...prev, id])
    try {
      await save([], [id])
    } catch {
      setDeletedIds((prev) => prev.filter((d) => d !== id)) // не удалился — показываем снова
    }
  }

  return (
    <section className={`${styles.answerForm} ${styles.taskAnswerBox}`}>
      <h3>Ваш ответ к заданию</h3>
      <textarea
        className={styles.textarea}
        rows={3}
        placeholder="Ответ, решение или комментарий..."
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        onBlur={() => save().catch(() => {})}
      />
      <label className={styles.fileButton}>
        📎 Прикрепить файлы
        <input type="file" multiple accept={ACCEPT} className={styles.hiddenInput} onChange={handleFilesChange} />
      </label>
      {(savedFiles.length > 0 || uploading.length > 0) && (
        <ul className={styles.files}>
          {savedFiles.map((f) => (
            <li key={f.id}>
              <a className={styles.link} href={f.url} download={f.name}>
                📎 {f.name}
              </a>
              <button type="button" className={styles.linkButton} onClick={() => handleRemoveSaved(f.id)}>
                Удалить
              </button>
            </li>
          ))}
          {uploading.map((f) => (
            <li key={f.id}>
              <span>{f.name}</span>
              <span className={styles.saveState}>загружается…</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.saveState}>
        {saveState === 'saving'
          ? 'Сохранение…'
          : saveState === 'saved'
            ? '✓ Ответ сохранён'
            : 'Ответ сохраняется автоматически'}
      </p>
    </section>
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


export default AssignmentPage