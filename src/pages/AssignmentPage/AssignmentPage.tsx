import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import styles from './AssignmentPage.module.css'
import panel from '../../components/AnswersPanel/AnswersPanel.module.css'
import * as api from '../../services/api'
import { lessonForSubjects, normalize } from '../../utils/subjects'
import type { Account, Assignment, AssignmentChanges, CommentActions, NumberedTask, ReviewStatus, StudentHomework, User } from '../../types'
import { ReviewButtons, StatusBadge } from '../../components/AnswerStatus/AnswerStatus'
import CommentThread from '../../components/CommentThread/CommentThread'
import { TaskAnswerContent, TaskAnswerForm, TaskAnswersList } from '../../components/TaskAnswers/TaskAnswers'
import { answerKeyTitle, hasDetailedAnswer, hasTaskAnswer } from '../../utils/lessonTasks'
import { FiguresContext } from '../../components/LatexDocument/FiguresContext'
import { ACCEPT, EMPTY_TASK_FILES, pickFiles, taskFileChanges, type FileEntry, type TaskFilesDraft } from '../../utils/uploads'
import { taskNumberTitle } from '../../utils/taskNumbers'
import { normalizeRecordingUrl, vkEmbedUrl } from '../../utils/vkVideo'
import LatexEditor from '../../components/LatexEditor/LatexEditor'
import NumberedTasksEditor from '../../components/NumberedTasksEditor/NumberedTasksEditor'
import TasksViewer from '../../components/TasksViewer/TasksViewer'

const MAX_TITLE_LENGTH = 255 // как Assignment.title на сервере

// Что открыто в панели заданий: номер классной работы, задания без номера или номер ДЗ ('hw-5')
type TasksKey = number | 'classwork' | 'homework' | `hw-${number}`

// Ключ задания в ответе ученика (StudentHomework.task_answers): номер классной работы — 'cw-5'
function answerKey(key: TasksKey): string {
  return typeof key === 'number' ? `cw-${key}` : key
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

const NO_FIGURES: NonNullable<Assignment['figures']> = []

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
    (user.role === 'teacher' || lessonForSubjects(account?.subjects, found))
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
    <FiguresContext.Provider value={assignment.figures ?? NO_FIGURES}>
      <AssignmentDetails
        assignment={assignment}
        user={user}
        studentId={account?.id}
        students={accounts.filter((a) => a.role === 'student' && lessonForSubjects(a.subjects, assignment))}
        onUpdate={onUpdate}
        onSubmitStudentHomework={onSubmitStudentHomework}
        onReview={onReview}
        commentActions={commentActions}
      />
    </FiguresContext.Provider>
  )
}

interface DetailsProps {
  assignment: Assignment
  user: User
  studentId?: number
  students: Account[] // ученики, которым виден урок
  onUpdate: (id: Assignment['id'], changes: AssignmentChanges) => Promise<void>
  onSubmitStudentHomework?: (assignmentId: number) => Promise<void> | void
  onReview?: (assignmentId: number, answerId: number, status: ReviewStatus) => Promise<void>
  commentActions?: CommentActions
}

function AssignmentDetails({ assignment, user, studentId, students, onUpdate, onSubmitStudentHomework, onReview, commentActions }: DetailsProps) {
  const canEdit = user.role === 'teacher'

  const [isEditing, setIsEditing] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [isEditingRecording, setIsEditingRecording] = useState(false)
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
  const [answerFiles, setAnswerFiles] = useState<FileEntry[]>([]) // новые файлы ко всему уроку
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

  // Номер по ключу задания (у заданий без номера — undefined)
  const numberedOf = (key: TasksKey) =>
    typeof key === 'number'
      ? assignment.numbered_tasks?.find((t) => t.number === key)
      : key.startsWith('hw-')
        ? assignment.homework?.numbered_tasks?.find((t) => `hw-${t.number}` === key)
        : undefined
  // Только краткий ответ (без программы и файлов) или обязательный развёрнутый — так решил учитель
  const isShortOnly = (key: TasksKey) => Boolean(numberedOf(key)?.short_only)
  const isDetailedRequired = (key: TasksKey) => Boolean(numberedOf(key)?.detailed_required && !numberedOf(key)?.short_only)
  // Номера, к которым ученик ещё не прикрепил обязательный развёрнутый ответ, — без них ДЗ не отправить
  const missingDetailed = [
    ...shownNumbered.map((t) => ({ key: t.number as TasksKey, title: `${taskNumberTitle(t.number)} (класс)` })),
    ...shownHomeworkNumbered.map((t) => ({ key: `hw-${t.number}` as TasksKey, title: `${taskNumberTitle(t.number)} (дз)` })),
  ].filter(({ key }) => isDetailedRequired(key) && !hasDetailedAnswer(myAnswer, answerKey(key)))
  const needsDetailed = (key: TasksKey) => user.role === 'student' && missingDetailed.some((m) => m.key === key)

  // Под открытым заданием: ученику — форма ответа, учителю — ответы учеников к этому заданию
  const answerBlock = (key: TasksKey) =>
    user.role === 'student' ? (
      <TaskAnswerForm
        key={answerKey(key)}
        answer={myAnswer}
        taskKey={answerKey(key)}
        shortOnly={isShortOnly(key)}
        detailedRequired={isDetailedRequired(key)}
        onSave={handleSaveTaskAnswer}
      />
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

  function handleAnswerFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { entries, error } = pickFiles(e.target.files)
    setAnswerFiles((prev) => [...prev, ...entries])
    setSubmitError(error)
    e.target.value = ''
  }

  async function handleSubmitAnswer() {
    if (!assignment.id || missingDetailed.length > 0) return
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
        files: answerFiles.map((f) => f.file),
        deleteFileIds: deletedSavedFileIds,
      })
      // Перезагружаем задание, чтобы сохранённый ответ подтянулся с сервера
      if (onSubmitStudentHomework) {
        await onSubmitStudentHomework(assignment.id)
      }
      setDeletedSavedFileIds([])
      setAnswerFiles([])
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
    setNumberedTasks(assignment.numbered_tasks ?? [])
    setTasksLatex(assignment.tasks_latex ?? '')
    setTaskFiles(EMPTY_TASK_FILES)
    setEditError('')
    setIsEditing(false)
  }

  async function handleSaveTitle(value: string) {
    const title = value.trim()
    if (!title) throw new Error('Введите название урока')
    await onUpdate(assignment.id!, { title })
    setIsEditingTitle(false)
  }

  async function handleSaveRecording(value: string) {
    await onUpdate(assignment.id!, { recording_url: value.trim() })
    setIsEditingRecording(false)
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
          {isEditingTitle ? (
            <FieldEditor
              label="Название урока"
              initialValue={assignment.title}
              maxLength={MAX_TITLE_LENGTH}
              onSave={handleSaveTitle}
              onCancel={() => setIsEditingTitle(false)}
            />
          ) : (
            <div className={styles.heading}>
              <h1 className={styles.title}>{assignment.title}</h1>
              {canEdit && (
                <button type="button" className={styles.editButton} onClick={() => setIsEditingTitle(true)}>
                  Изменить название
                </button>
              )}
            </div>
          )}
          {assignment.deadline && <p className={styles.deadline}>Сдать до: {assignment.deadline}</p>}

          {isEditing ? (
            <div className={styles.editor}>
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
                <div className={styles.heading}>
                  <h2>Запись урока</h2>
                  {canEdit && !isEditingRecording && (
                    <button type="button" className={styles.editButton} onClick={() => setIsEditingRecording(true)}>
                      {assignment.recording_url ? 'Изменить ссылку' : 'Добавить ссылку'}
                    </button>
                  )}
                </div>
                {isEditingRecording ? (
                  <FieldEditor
                    label="Ссылка на запись урока"
                    type="url"
                    placeholder="https://vkvideo.ru/video-… или код для вставки"
                    hint="Видео VK покажется прямо в уроке. Если видео с доступом «по ссылке» не показывается — вставь сюда «Поделиться → Код для вставки». Чтобы убрать запись, очисти поле."
                    initialValue={assignment.recording_url ?? ''}
                    normalizeValue={normalizeRecordingUrl}
                    onSave={handleSaveRecording}
                    onCancel={() => setIsEditingRecording(false)}
                  />
                ) : assignment.recording_url && vkEmbedUrl(assignment.recording_url) ? (
                  <>
                    <div className={styles.player}>
                      <iframe
                        src={vkEmbedUrl(assignment.recording_url)!}
                        title="Запись урока"
                        allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                      />
                    </div>
                    <a
                      className={styles.link}
                      href={assignment.recording_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Открыть в VK Видео
                    </a>
                  </>
                ) : assignment.recording_url ? (
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
                        needsDetailed={needsDetailed(t.number)}
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
                            needsDetailed={needsDetailed(`hw-${t.number}`)}
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

          {/* Секция "Ответы учеников" — только для учителей, в том же виде, что панель на главной */}
          {user.role === 'teacher' && (
            <LessonAnswers
              assignment={assignment}
              students={students}
              answerOrder={answerOrder}
              correctAnswer={correctAnswer}
              currentUserId={user.id}
              onReview={onReview}
              commentActions={commentActions}
            />
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
              {/* Файлы ко всему уроку; к отдельному заданию они прикрепляются в его окне */}
              <span className={styles.label}>Файлы ко всему уроку</span>
              <label className={styles.fileButton}>
                📎 Прикрепить файлы
                <input type="file" multiple accept={ACCEPT} className={styles.hiddenInput} onChange={handleAnswerFilesChange} />
              </label>
              {answerFiles.length > 0 && (
                <ul className={styles.files}>
                  {answerFiles.map((f) => (
                    <li key={f.id}>
                      <span>{f.name}</span>
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => setAnswerFiles((prev) => prev.filter((x) => x.id !== f.id))}
                      >
                        Удалить
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
              {missingDetailed.length > 0 && (
                <div className={styles.missingDetailed} role="alert">
                  <p>
                    У вас не прикреплён развёрнутый ответ к{' '}
                    {missingDetailed.length === 1 ? 'номеру' : 'номерам'}:{' '}
                    {missingDetailed.map((m, i) => (
                      <span key={String(m.key)}>
                        {i > 0 && ', '}
                        <button type="button" className={styles.missingLink} onClick={() => setOpenTasks(m.key)}>
                          {m.title}
                        </button>
                      </span>
                    ))}
                  </p>
                  <p className={styles.missingHint}>
                    Откройте номер, вставьте программу или прикрепите файл — после этого ДЗ можно отправить.
                  </p>
                </div>
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={handleSubmitAnswer}
                  disabled={isSubmitting || missingDetailed.length > 0}
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

interface FieldEditorProps {
  label: string
  initialValue: string
  type?: 'text' | 'url'
  placeholder?: string
  hint?: string
  maxLength?: number
  normalizeValue?: (value: string) => string
  onSave: (value: string) => Promise<void>
  onCancel: () => void
}

// Правка одного поля урока на месте: сохраняется отдельно от материалов.
// При ошибке форма остаётся открытой и показывает сообщение
function FieldEditor({ label, initialValue, type = 'text', placeholder, hint, maxLength, normalizeValue, onSave, onCancel }: FieldEditorProps) {
  const [value, setValue] = useState(initialValue)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSaving(true)
    setError('')
    try {
      await onSave(value)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить изменения')
      setIsSaving(false)
    }
  }

  return (
    <form className={styles.editor} onSubmit={handleSubmit}>
      <label className={styles.label}>
        {label}
        <input
          className={styles.input}
          type={type}
          placeholder={placeholder}
          maxLength={maxLength}
          value={value}
          autoFocus
          onChange={(e) => setValue(normalizeValue ? normalizeValue(e.target.value) : e.target.value)}
        />
        {hint && <span className={styles.hint}>{hint}</span>}
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={isSaving}>
          {isSaving ? 'Сохранение...' : 'Сохранить'}
        </button>
        <button type="button" className={styles.secondary} onClick={onCancel} disabled={isSaving}>
          Отмена
        </button>
      </div>
    </form>
  )
}

// Кнопка задания: «N задание» или «Другие задания»
function OpenTasksButton({ title, isOpen, answered, needsDetailed, onOpen }: {
  title: string
  isOpen: boolean
  answered?: boolean
  needsDetailed?: boolean // развёрнутый ответ обязателен, а его ещё нет
  onOpen: () => void
}) {
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
        {needsDetailed ? (
          <span className={styles.openTasksMissing}>нужен развёрнутый ответ</span>
        ) : (
          answered && <span className={styles.openTasksAnswered}>✓ ответ прикреплён</span>
        )}
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


export default AssignmentPage
interface LessonAnswersProps {
  assignment: Assignment
  students: Account[]
  answerOrder: string[]
  correctAnswer: (key: string) => string | undefined
  currentUserId?: number
  onReview?: (assignmentId: number, answerId: number, status: ReviewStatus) => Promise<void>
  commentActions?: CommentActions
}

function formatAnswerDate(value?: string) {
  return value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : ''
}

// Ответы учеников к уроку — как панель «Ответы учеников» на главной:
// сверху ученики с отметками, ниже карточка ответа выбранного ученика
function LessonAnswers({ assignment, students, answerOrder, correctAnswer, currentUserId, onReview, commentActions }: LessonAnswersProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [isChatOpen, setIsChatOpen] = useState(false)

  const answers = assignment.student_homeworks ?? []
  const answerOf = (id: number): StudentHomework | undefined => answers.find((a) => a.student === id)

  // Ученики урока, плюс приславшие ответ, если предмет у них с тех пор сменился
  const list = students.map((s) => ({ id: s.id!, name: s.name }))
  for (const a of answers) {
    if (a.student !== undefined && !list.some((s) => s.id === a.student)) {
      list.push({ id: a.student, name: a.student_name ?? 'Ученик' })
    }
  }

  // Пока никого не выбрали — первый ученик, приславший ответ
  const selected = list.find((s) => s.id === selectedId) ?? list.find((s) => answerOf(s.id)) ?? list[0]
  const sh = selected ? answerOf(selected.id) : undefined

  const acceptedCount = answers.filter((a) => a.status === 'accepted').length
  const pendingCount = answers.filter((a) => (a.status ?? 'pending') === 'pending').length

  return (
    <section className={`${panel.panel} ${styles.lessonAnswers}`}>
      <div className={panel.header}>
        <h2>
          Ответы учеников <span className={panel.count}>({answers.length})</span>
        </h2>
      </div>

      {list.length === 0 ? (
        <p className={panel.empty}>Учеников пока нет</p>
      ) : (
        <>
          <div className={panel.students}>
            {list.map((s) => {
              const a = answerOf(s.id)
              const mark = !a ? '—' : a.status === 'accepted' ? '✓' : a.status === 'rejected' ? '✗' : '•'
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`${panel.student} ${s.id === selected?.id ? panel.active : ''}`}
                  onClick={() => {
                    setSelectedId(s.id)
                    setIsChatOpen(false)
                  }}
                >
                  {s.name}
                  <span className={panel.badge}>{mark}</span>
                </button>
              )
            })}
          </div>

          <p className={panel.summary}>
            Прислали {answers.length} из {list.length} · сдано {acceptedCount} · ждут проверки {pendingCount}
          </p>

          {selected && !sh && <p className={panel.empty}>{selected.name} пока ничего не прислал(а)</p>}

          {sh && (
            <div className={panel.card}>
              <div className={panel.cardHeader}>
                <span className={panel.title}>{sh.student_name ?? selected?.name}</span>
                <span className={panel.date}>{formatAnswerDate(sh.submitted_at)}</span>
              </div>
              <div className={panel.meta}>
                <span className={panel.subject}>{assignment.subject}</span>
                <StatusBadge status={sh.status} />
              </div>

              {sh.description ? (
                <p className={panel.description}>{sh.description}</p>
              ) : (
                <p className={panel.empty}>Без описания</p>
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
                <ul className={panel.files}>
                  {sh.files.filter((f) => !f.task_key).map((f) => (
                    <li key={f.id}>
                      <a className={panel.link} href={f.url} download={f.name}>
                        📎 {f.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              {onReview && (
                <ReviewButtons status={sh.status} onChange={(value) => onReview(assignment.id!, sh.id!, value)} />
              )}

              {commentActions && (
                <>
                  <button
                    type="button"
                    className={`${panel.threadToggle} ${isChatOpen ? panel.threadActive : ''}`}
                    onClick={() => setIsChatOpen((open) => !open)}
                    aria-expanded={isChatOpen}
                  >
                    💬 Переписка ({sh.comments?.length ?? 0})
                    <span className={panel.chevron}>{isChatOpen ? '▲' : '▼'}</span>
                  </button>
                  {isChatOpen && (
                    <CommentThread
                      comments={sh.comments}
                      currentUserId={currentUserId}
                      canDeleteAll
                      placeholder="Ответить ученику..."
                      onSend={(text) => commentActions.add(assignment.id!, sh.id!, text)}
                      onEdit={(id, text) => commentActions.edit(assignment.id!, sh.id!, id, text)}
                      onDelete={(id) => commentActions.remove(assignment.id!, sh.id!, id)}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
