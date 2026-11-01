import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDataChannel, useParticipants } from '@livekit/components-react'
import styles from './CallTasks.module.css'
import * as api from '../../services/api'
import LatexDocument from '../../components/LatexDocument/LatexDocument'
import { TaskAnswerForm, TaskAnswersList } from '../../components/TaskAnswers/TaskAnswers'
import { answerKeyTitle, lessonTasks, type LessonTask } from '../../utils/lessonTasks'
import type { Assignment, Call } from '../../types'

// Сообщения по каналу данных LiveKit. Сами данные в них не передаём:
// «show» только будит учеников, а что показано — они берут с сервера (менять это может лишь учитель)
const TOPIC = 'spirit-tasks'
type TasksMessage =
  | { type: 'show' } // учитель сменил урок или задание
  | { type: 'hello' } // учитель подключился — ученики, сообщите, что смотрите
  | { type: 'viewing'; task: string | null } // ученик смотрит своё задание; null — следит за учителем
  | { type: 'answer' } // ученик сохранил ответ — учителю обновить ответы

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface Props {
  call: Call
  isTeacher: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
  onCallChange: (call: Call) => void
}

// Задания урока прямо в созвоне. Учитель выбирает урок и задание и нажимает «Показать ученикам» —
// у всех учеников открывается это задание. Ученик может листать и другие задания и прикреплять ответы
function CallTasks({ call, isTeacher, open, onOpen, onClose, onCallChange }: Props) {
  const [loaded, setLoaded] = useState<Assignment | null>(null)
  const [lessonError, setLessonError] = useState('')
  const [lessons, setLessons] = useState<Assignment[]>([]) // учителю — для выбора урока
  // Что открыто у себя: учитель листает задания, не показывая их; ученик null — следит за учителем
  const [ownTask, setOwnTask] = useState<string | null>(null)
  // Ученики, которые ушли от задания учителя: identity → {имя, задание}
  const [away, setAway] = useState<Record<string, { name: string; task: string }>>({})
  const [error, setError] = useState('')

  const lessonId = call.assignment
  const shownTask = call.shown_task

  const loadLesson = useCallback(async () => {
    if (lessonId == null) return
    try {
      setLoaded(await api.getAssignment(lessonId))
      setLessonError('')
    } catch {
      setLoaded(null)
      setLessonError(isTeacher ? 'Не удалось загрузить урок' : 'Задания этого урока вам недоступны')
    }
  }, [lessonId, isTeacher])

  // Урок сменился — загружаем его задания
  useEffect(() => {
    if (lessonId == null) return
    let cancelled = false
    api
      .getAssignment(lessonId)
      .then((data) => {
        if (cancelled) return
        setLoaded(data)
        setLessonError('')
      })
      .catch(() => {
        if (!cancelled) setLessonError(isTeacher ? 'Не удалось загрузить урок' : 'Задания этого урока вам недоступны')
      })
    return () => {
      cancelled = true
    }
  }, [lessonId, isTeacher])

  useEffect(() => {
    if (!isTeacher) return
    api.getAllAssignments().then(setLessons).catch(() => setLessons([]))
  }, [isTeacher])

  // Учителю ответы учеников приходят сигналом «answer» — обновляем не чаще раза в секунду
  const reloadTimer = useRef<number | undefined>(undefined)
  const scheduleReload = useCallback(() => {
    window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(() => void loadLesson(), 1000)
  }, [loadLesson])
  useEffect(() => () => window.clearTimeout(reloadTimer.current), [])

  const refreshCall = useCallback(async () => {
    try {
      const fresh = await api.getCall(call.id)
      onCallChange(fresh)
      if (fresh.shown_task) onOpen()
    } catch {
      // урок закончился — страница созвона закроется сама
    }
  }, [call.id, onCallChange, onOpen])

  const sendRef = useRef<(m: TasksMessage) => void>(() => {})
  const ownTaskRef = useRef<string | null>(null)

  const onMessage = useCallback(
    (msg: { payload: Uint8Array; from?: { identity: string; name?: string } }) => {
      let data: TasksMessage
      try {
        data = JSON.parse(decoder.decode(msg.payload))
      } catch {
        return
      }
      if (isTeacher) {
        if (data.type === 'answer') scheduleReload()
        if (data.type === 'viewing' && msg.from) {
          const { identity, name } = msg.from
          setAway((prev) => {
            const next = { ...prev }
            if (data.task) next[identity] = { name: name || identity, task: data.task }
            else delete next[identity]
            return next
          })
        }
      } else if (data.type === 'show') {
        setOwnTask(null) // учитель показал новое — все переходят к нему
        void refreshCall()
      } else if (data.type === 'hello') {
        sendRef.current({ type: 'viewing', task: ownTaskRef.current })
      }
    },
    [isTeacher, scheduleReload, refreshCall],
  )
  const { send } = useDataChannel(TOPIC, onMessage)

  useEffect(() => {
    sendRef.current = (m) => void send(encoder.encode(JSON.stringify(m)), { reliable: true }).catch(() => {})
    ownTaskRef.current = ownTask
  })

  // Учитель пришёл (или вернулся) — спрашиваем, кто что смотрит
  useEffect(() => {
    if (isTeacher) sendRef.current({ type: 'hello' })
  }, [isTeacher])

  // Ученик открыл не то задание, что показал учитель, — сообщаем учителю
  useEffect(() => {
    if (!isTeacher) sendRef.current({ type: 'viewing', task: ownTask })
  }, [isTeacher, ownTask])

  // Ушедшие из созвона пропадают из списка «смотрят другое»
  const participants = useParticipants()
  const present = new Set(participants.map((p) => p.identity))
  const awayList = Object.entries(away).filter(([identity, v]) => present.has(identity) && v.task !== shownTask)

  // Урок сменили — старый, пока грузится новый, не показываем
  const lesson = loaded && loaded.id === lessonId ? loaded : null
  const tasks = useMemo(() => (lesson ? lessonTasks(lesson) : []), [lesson])
  const viewKey = ownTask ?? shownTask
  const current: LessonTask | undefined = tasks.find((t) => t.key === viewKey)
  const myAnswer = isTeacher ? undefined : lesson?.student_homeworks?.[0]

  async function show(assignment: number | null, task: string) {
    setError('')
    try {
      onCallChange(await api.showCallTask(call.id, { assignment, task }))
      sendRef.current({ type: 'show' })
      if (assignment !== lessonId) setOwnTask(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось показать задание')
    }
  }

  async function handleSaveAnswer(task: string, text: string, files: File[], deleteFileIds: Array<number | string>) {
    if (lessonId == null) return
    await api.submitTaskAnswer({ assignmentId: lessonId, task, text, files, deleteFileIds })
    await loadLesson()
    sendRef.current({ type: 'answer' })
  }

  if (!open) return null

  return (
    <aside className={styles.panel} aria-label="Задания урока">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h2 className={styles.title}>Задания</h2>
          {lesson && <p className={styles.subtitle}>{lesson.title} · {lesson.subject}</p>}
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Скрыть задания">
          ✕
        </button>
      </header>

      <div className={styles.body}>
        {isTeacher && (
          <label className={styles.lessonField}>
            Урок
            <select
              value={lessonId ?? ''}
              onChange={(e) => void show(e.target.value ? Number(e.target.value) : null, '')}
            >
              <option value="">Без урока</option>
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title} · {l.subject}
                </option>
              ))}
            </select>
          </label>
        )}

        {lessonId == null ? (
          <p className={styles.note}>{isTeacher ? 'Выберите урок, чтобы открыть его задания' : 'Учитель пока не открыл задания урока'}</p>
        ) : lessonError ? (
          <p className={styles.note}>{lessonError}</p>
        ) : (
          !lesson && <p className={styles.note}>Загружаем задания…</p>
        )}
        {lesson && tasks.length === 0 && <p className={styles.note}>В этом уроке нет заданий</p>}

        {tasks.length > 0 && (
          <div className={styles.chips}>
            {tasks.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`${styles.chip} ${t.key === viewKey ? styles.chipActive : ''}`}
                aria-pressed={t.key === viewKey}
                onClick={() => setOwnTask(!isTeacher && t.key === shownTask ? null : t.key)}
              >
                {t.title} <span className={styles.chipGroup}>{t.group}</span>
                {t.key === shownTask && <span className={styles.shownDot} title="Это задание открыто у учеников" />}
              </button>
            ))}
          </div>
        )}

        {isTeacher && lesson && (
          <div className={styles.teacherActions}>
            {current && current.key !== shownTask && (
              <button type="button" className={styles.primary} onClick={() => void show(lessonId, current.key)}>
                Показать ученикам
              </button>
            )}
            {shownTask && (
              <span className={styles.shownNote}>
                У учеников: <strong>{answerKeyTitle(shownTask)}</strong>
                <button type="button" className={styles.linkButton} onClick={() => void show(lessonId, '')}>
                  Скрыть
                </button>
              </span>
            )}
          </div>
        )}

        {isTeacher && awayList.length > 0 && (
          <p className={styles.away}>
            Смотрят другое: {awayList.map(([, v]) => `${v.name} (${answerKeyTitle(v.task)})`).join(', ')}
          </p>
        )}

        {!isTeacher && ownTask !== null && shownTask && ownTask !== shownTask && (
          <button type="button" className={styles.back} onClick={() => setOwnTask(null)}>
            ← Вернуться к заданию учителя
          </button>
        )}
        {!isTeacher && lesson && !current && tasks.length > 0 && (
          <p className={styles.note}>Учитель пока не показал задание — можно открыть любое сверху</p>
        )}

        {error && <p className={styles.error}>{error}</p>}

        {current && lesson && (
          <article className={styles.task}>
            <h3 className={styles.taskTitle}>
              {current.title} · {current.group === 'класс' ? 'классная работа' : 'домашнее задание'}
            </h3>
            {isTeacher && current.answer?.trim() && (
              <p className={styles.answer}>
                Ответ: <strong>{current.answer}</strong> <span className={styles.answerNote}>· видите только вы</span>
              </p>
            )}
            {current.attachments.length > 0 && (
              <ul className={styles.attachments}>
                {current.attachments.map((f) => (
                  <li key={f.name + f.url}>
                    <a href={f.url} download={f.name}>📎 {f.name}</a>
                  </li>
                ))}
              </ul>
            )}
            {current.source.trim() && <LatexDocument source={current.source} files={current.files} taskNumber={current.number} />}
            {isTeacher ? (
              <TaskAnswersList answers={lesson.student_homeworks ?? []} taskKey={current.key} />
            ) : (
              <TaskAnswerForm
                key={`${lesson.id}-${current.key}`}
                answer={myAnswer}
                taskKey={current.key}
                onSave={handleSaveAnswer}
              />
            )}
          </article>
        )}
      </div>
    </aside>
  )
}

export default CallTasks
