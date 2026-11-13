import { useState, type FormEvent } from 'react'
import styles from './AssignmentForm.module.css'
import { EMPTY_TASK_FILES, taskFileChanges, type TaskFilesDraft } from '../../utils/uploads'
import NumberedTasksEditor from '../NumberedTasksEditor/NumberedTasksEditor'
import { lessonForSubjects, normalize } from '../../utils/subjects'
import { allTopics, guessTopic, EXAMS_TOPIC } from '../../utils/topics'
import type { Assignment, ExamResults, NewAssignment, NumberedTask, Subject } from '../../types'
import { normalizeRecordingUrl } from '../../utils/vkVideo'

interface AssignmentFormProps {
  onAdd: (data: NewAssignment) => Promise<void> | void
  subjects: Subject[] // предметы из списка — из них выбирают, а можно ввести новый
  onDeleteSubject: (id: number) => Promise<void>
  items: Assignment[] // уроки — из них папки предмета для выбора
}

// Сегодня в формате поля даты: 'ГГГГ-ММ-ДД' по местному времени
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MAX_SUBJECT_LENGTH = 100 // как Assignment.subject на сервере
const NEW_SUBJECT = '__new__' // значение пункта «Новый предмет» — с настоящим предметом не совпадёт
const NEW_TOPIC = '__new_topic__' // пункт «+ Новая папка…»
const MAX_TOPIC_LENGTH = 60 // как Assignment.topic на сервере
const DEFAULT_EXAM_MINUTES = '235' // ЕГЭ по информатике — 3 ч 55 мин

function AssignmentForm({ onAdd, subjects, onDeleteSubject, items }: AssignmentFormProps) {
  const [isOpen, setIsOpen] = useState(false) // по умолчанию свёрнута, как другие панели
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [deadline, setDeadline] = useState('')
  const [lessonDate, setLessonDate] = useState(today) // день занятия — по умолчанию сегодня
  const [recordingUrl, setRecordingUrl] = useState('')
  const [numberedTasks, setNumberedTasks] = useState<NumberedTask[]>([])
  const [error, setError] = useState('')
  // Пробник: урок с таймером — задания номерами, без записи и ДЗ
  const [isExam, setIsExam] = useState(false)
  const [examMinutes, setExamMinutes] = useState(DEFAULT_EXAM_MINUTES)
  const [examResults, setExamResults] = useState<ExamResults>('finish')
  // Папка: null — угадывается по названию (пробник — «Пробники»), пока учитель не выберет сам
  const [topicChoice, setTopicChoice] = useState<string | null>(null)
  const [newTopic, setNewTopic] = useState('')

  const [homeworkTasks, setHomeworkTasks] = useState<NumberedTask[]>([])
  // Файлы к номерам классной работы и ДЗ
  const [taskFiles, setTaskFiles] = useState<TaskFilesDraft>(EMPTY_TASK_FILES)
  const [homeworkTaskFiles, setHomeworkTaskFiles] = useState<TaskFilesDraft>(EMPTY_TASK_FILES)

  // Новый предмет, совпавший с уже существующим, пишем как существующий — без дублей «математика» / «Математика»
  const typed = newSubject.trim().replace(/\s+/g, ' ')
  const finalSubject =
    subject === NEW_SUBJECT ? subjects.find((s) => normalize(s.name) === normalize(typed))?.name ?? typed : subject

  // Папки выбранного предмета и угаданная по названию — в списке выбора
  const guessed = guessTopic(title, isExam)
  const topicOptions = allTopics(
    [...items.filter((a) => finalSubject && lessonForSubjects([finalSubject], a)), { topic: guessed }] as Assignment[],
  )
  const topicValue = topicChoice ?? guessed
  const finalTopic = (topicValue === NEW_TOPIC ? newTopic : topicValue).trim().replace(/\s+/g, ' ')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (title.trim() === '' || finalSubject === '') {
      setError(subject === NEW_SUBJECT ? 'Введите название нового предмета' : 'Заполните название и предмет')
      return
    }
    const minutes = Number(examMinutes)
    if (isExam && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) {
      setError('Время пробника — от 1 до 600 минут')
      return
    }
    if (!finalTopic) {
      setError(topicValue === NEW_TOPIC ? 'Введите название новой папки' : 'Выберите папку для урока')
      return
    }

    try {
      await onAdd({
        title: title.trim(),
        subject: finalSubject,
        deadline: deadline || undefined,
        lesson_date: lessonDate || undefined,
        recording_url: isExam ? undefined : recordingUrl.trim() || undefined,
        exam_minutes: isExam ? minutes : undefined,
        exam_results: isExam ? examResults : undefined,
        topic: finalTopic,
        numbered_tasks: numberedTasks,
        homework:
          !isExam && homeworkTasks.length
            ? {
                numbered_tasks: homeworkTasks,
                ...taskFileChanges(homeworkTaskFiles, homeworkTasks.map((t) => t.number)),
              }
            : undefined,
        ...taskFileChanges(taskFiles, numberedTasks.map((t) => t.number)),
      })

      setTitle('')
      setSubject('')
      setNewSubject('')
      setDeadline('')
      setLessonDate(today())
      setRecordingUrl('')
      setNumberedTasks([])
      setHomeworkTasks([])
      setTaskFiles(EMPTY_TASK_FILES)
      setHomeworkTaskFiles(EMPTY_TASK_FILES)
      setIsExam(false)
      setExamMinutes(DEFAULT_EXAM_MINUTES)
      setExamResults('finish')
      setTopicChoice(null)
      setNewTopic('')
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
        <h2>{isExam ? 'Новый пробник' : 'Новое задание'}</h2>
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
          <div className={styles.kind} role="radiogroup" aria-label="Что добавить">
            <button
              type="button"
              role="radio"
              aria-checked={!isExam}
              className={!isExam ? styles.kindActive : styles.kindOption}
              onClick={() => setIsExam(false)}
            >
              Урок
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={isExam}
              className={isExam ? styles.kindActive : styles.kindOption}
              onClick={() => setIsExam(true)}
            >
              ⏱ Пробник
            </button>
          </div>

          <input
            type="text"
            placeholder={isExam ? 'Название, например: Пробник ЕГЭ №3' : 'Название'}
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

          <label className={styles.label}>
            Папка
            <select
              value={topicValue}
              onChange={(e) => {
                setTopicChoice(e.target.value)
                setError('')
              }}
            >
              <option value="">— выберите папку —</option>
              {topicOptions.map((t) => (
                <option key={t} value={t}>
                  {t === guessed && topicChoice === null ? `${t} (по названию)` : t}
                </option>
              ))}
              <option value={NEW_TOPIC}>+ Новая папка…</option>
            </select>
            {topicValue === NEW_TOPIC && (
              <input
                type="text"
                placeholder="Например: №12 или Контрольные"
                value={newTopic}
                maxLength={MAX_TOPIC_LENGTH}
                autoFocus
                onChange={(e) => setNewTopic(e.target.value)}
              />
            )}
            <span className={styles.hint}>
              {isExam
                ? `Пробники по умолчанию — в папке «${EXAMS_TOPIC}».`
                : 'Подбирается по названию: «26 задание урок 3» → «№26». Можно выбрать другую.'}
            </span>
          </label>

          <label className={styles.label}>
            День занятия
            <input
              type="date"
              value={lessonDate}
              onChange={(e) => setLessonDate(e.target.value)}
            />
          </label>

          <label className={styles.label}>
            Срок сдачи (необязательно)
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </label>

          {isExam && (
            <label className={styles.label}>
              Время на пробник, минут
              <input
                type="number"
                min={1}
                max={600}
                value={examMinutes}
                onChange={(e) => setExamMinutes(e.target.value)}
              />
              <span className={styles.hint}>
                Отсчёт у каждого ученика свой — с нажатия «Начать пробник». До начала задания скрыты.
              </span>
            </label>
          )}

          {isExam && (
            <div className={styles.subjectSection}>
              <span className={styles.label}>Когда ученик увидит, где верно, а где нет</span>
              <div className={styles.subjectOptions}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="examResults"
                    checked={examResults === 'finish'}
                    onChange={() => setExamResults('finish')}
                  />
                  Сразу после сдачи
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="examResults"
                    checked={examResults === 'review'}
                    onChange={() => setExamResults('review')}
                  />
                  После проверки учителем или куратором
                </label>
              </div>
            </div>
          )}

          {!isExam && (
            <label className={styles.label}>
              Ссылка на запись урока
              <input
                type="url"
                placeholder="https://vkvideo.ru/video-… или код для вставки"
                value={recordingUrl}
                onChange={(e) => setRecordingUrl(normalizeRecordingUrl(e.target.value))}
              />
            </label>
          )}

          <NumberedTasksEditor
            value={numberedTasks}
            onChange={setNumberedTasks}
            taskFiles={taskFiles}
            onTaskFilesChange={setTaskFiles}
          />

          {!isExam && (
            <>
              <div className={styles.divider} />

              <h3>Домашнее задание</h3>
              <NumberedTasksEditor
                value={homeworkTasks}
                onChange={setHomeworkTasks}
                homework
                taskFiles={homeworkTaskFiles}
                onTaskFilesChange={setHomeworkTaskFiles}
              />
            </>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.submit}>
            {isExam ? 'Добавить пробник' : 'Добавить задание'}
          </button>
        </>
      )}
    </form>
  )
}

export default AssignmentForm