import { useState, type FormEvent } from 'react'
import styles from './AssignmentForm.module.css'
import { EMPTY_TASK_FILES, taskFileChanges, type TaskFilesDraft } from '../../utils/uploads'
import NumberedTasksEditor from '../NumberedTasksEditor/NumberedTasksEditor'
import { normalize } from '../../utils/subjects'
import type { NewAssignment, NumberedTask, Subject } from '../../types'
import { normalizeRecordingUrl } from '../../utils/vkVideo'

interface AssignmentFormProps {
  onAdd: (data: NewAssignment) => Promise<void> | void
  subjects: Subject[] // предметы из списка — из них выбирают, а можно ввести новый
  onDeleteSubject: (id: number) => Promise<void>
}

const MAX_SUBJECT_LENGTH = 100 // как Assignment.subject на сервере
const NEW_SUBJECT = '__new__' // значение пункта «Новый предмет» — с настоящим предметом не совпадёт

function AssignmentForm({ onAdd, subjects, onDeleteSubject }: AssignmentFormProps) {
  const [isOpen, setIsOpen] = useState(false) // по умолчанию свёрнута, как другие панели
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [newSubject, setNewSubject] = useState('')
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

    // Новый предмет, совпавший с уже существующим, пишем как существующий — без дублей «математика» / «Математика»
    const typed = newSubject.trim().replace(/\s+/g, ' ')
    const finalSubject =
      subject === NEW_SUBJECT ? subjects.find((s) => normalize(s.name) === normalize(typed))?.name ?? typed : subject

    if (title.trim() === '' || finalSubject === '') {
      setError(subject === NEW_SUBJECT ? 'Введите название нового предмета' : 'Заполните название и предмет')
      return
    }

    try {
      await onAdd({
        title: title.trim(),
        subject: finalSubject,
        description: description.trim(),
        deadline: deadline || undefined,
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
      setNewSubject('')
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

  async function handleDeleteSubject(subj: Subject) {
    if (!window.confirm(`Убрать предмет «${subj.name}» из списка?

Уроки по нему и предметы учеников не изменятся.`)) return
    try {
      await onDeleteSubject(subj.id)
      if (subject === subj.name) setSubject('')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить предмет')
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
              {subjects.map((subj) => (
                <label key={subj.id} className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="subject"
                    value={subj.name}
                    checked={subject === subj.name}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                  <span className={styles.subjectName}>{subj.name}</span>
                  <button
                    type="button"
                    className={styles.deleteSubject}
                    aria-label={`Удалить предмет ${subj.name}`}
                    title="Убрать предмет из списка"
                    onClick={(e) => {
                      e.preventDefault() // клик внутри label не должен выбирать предмет
                      void handleDeleteSubject(subj)
                    }}
                  >
                    ✕
                  </button>
                </label>
              ))}
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="subject"
                  value={NEW_SUBJECT}
                  checked={subject === NEW_SUBJECT}
                  onChange={(e) => setSubject(e.target.value)}
                />
                + Новый предмет
              </label>
              {subject === NEW_SUBJECT && (
                <input
                  type="text"
                  placeholder="Например, Физика"
                  value={newSubject}
                  maxLength={MAX_SUBJECT_LENGTH}
                  autoFocus
                  onChange={(e) => setNewSubject(e.target.value)}
                />
              )}
            </div>
          </div>

          <textarea
            placeholder="Описание урока"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <label className={styles.label}>
            Срок сдачи (необязательно)
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </label>

          <label className={styles.label}>
            Ссылка на запись урока
            <input
              type="url"
              placeholder="https://vkvideo.ru/video-… или код для вставки"
              value={recordingUrl}
              onChange={(e) => setRecordingUrl(normalizeRecordingUrl(e.target.value))}
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