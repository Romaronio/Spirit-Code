import { useState, type FormEvent } from 'react'
import styles from './AssignmentForm.module.css'
import { EMPTY_TASK_FILES, MAX_FILE_SIZE_MB, taskFileChanges, type TaskFilesDraft } from '../../utils/uploads'
import NumberedTasksEditor from '../NumberedTasksEditor/NumberedTasksEditor'
import type { NewAssignment, NumberedTask } from '../../types'

interface AssignmentFormProps {
  onAdd: (data: NewAssignment) => Promise<void> | void
}

const SUBJECTS = ['Математика', 'Информатика', 'Русский язык']

function AssignmentForm({ onAdd }: AssignmentFormProps) {
  const [isOpen, setIsOpen] = useState(false) // по умолчанию свёрнута, как другие панели
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [recordingUrl, setRecordingUrl] = useState('')
  const [numberedTasks, setNumberedTasks] = useState<NumberedTask[]>([])
  const [error, setError] = useState('')

  const [homeworkDescription, setHomeworkDescription] = useState('')
  const [homeworkTasks, setHomeworkTasks] = useState<NumberedTask[]>([])
  // Файлы к номерам классной работы и ДЗ
  const [taskFiles, setTaskFiles] = useState<TaskFilesDraft>(EMPTY_TASK_FILES)
  const [homeworkTaskFiles, setHomeworkTaskFiles] = useState<TaskFilesDraft>(EMPTY_TASK_FILES)

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
        numbered_tasks: numberedTasks,
        homework:
          homeworkDescription.trim() || homeworkTasks.length
            ? {
                description: homeworkDescription.trim(),
                numbered_tasks: homeworkTasks,
                ...taskFileChanges(homeworkTaskFiles, homeworkTasks.map((t) => t.number)),
              }
            : undefined,
        ...taskFileChanges(taskFiles, numberedTasks.map((t) => t.number)),
      })

      setTitle('')
      setSubject('')
      setDescription('')
      setDeadline('')
      setRecordingUrl('')
      setNumberedTasks([])
      setHomeworkDescription('')
      setHomeworkTasks([])
      setTaskFiles(EMPTY_TASK_FILES)
      setHomeworkTaskFiles(EMPTY_TASK_FILES)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при создании задания')
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.header}>
        <h2>Новое задание</h2>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
        >
          {isOpen ? 'Свернуть ▲' : 'Развернуть ▼'}
        </button>
      </div>

      {isOpen && (
        <>
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

          <NumberedTasksEditor
            value={numberedTasks}
            onChange={setNumberedTasks}
            taskFiles={taskFiles}
            onTaskFilesChange={setTaskFiles}
          />

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

          <NumberedTasksEditor
            value={homeworkTasks}
            onChange={setHomeworkTasks}
            taskFiles={homeworkTaskFiles}
            onTaskFilesChange={setHomeworkTaskFiles}
          />

          <p className={styles.label}>Каждый файл — до {MAX_FILE_SIZE_MB} МБ</p>
          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.submit}>
            Добавить задание
          </button>
        </>
      )}
    </form>
  )
}

export default AssignmentForm