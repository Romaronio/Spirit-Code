import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDataChannel, useParticipants } from '@livekit/components-react'
import styles from './CallTasks.module.css'
import * as api from '../../services/api'
import LatexDocument from '../../components/LatexDocument/LatexDocument'
import { TaskAnswerForm, TaskAnswersList } from '../../components/TaskAnswers/TaskAnswers'
import { answerKeyTitle, hasTaskAnswer, lessonTasks, type LessonTask } from '../../utils/lessonTasks'
import { FiguresContext } from '../../components/LatexDocument/FiguresContext'
import type { Assignment, Call, CallAnswer, StudentHomework } from '../../types'

// Сообщения по каналу данных LiveKit. Сами данные в них не передаём:
// «show» только будит учеников, а что показано — они берут с сервера (менять это может лишь учитель)
const TOPIC = 'spirit-tasks'
type TasksMessage =
  | { type: 'show' } // учитель сменил урок или задание
  | { type: 'hello' } // учитель подключился — ученики, сообщите, что смотрите
  | { type: 'viewing'; task: string | null } // ученик смотрит своё задание; null — следит за учителем
  | { type: 'answer' } // ученик сохранил ответ — учителю обновить ответы
  | { type: 'draft'; task: string; text: string } // ученик печатает ответ — уходит только учителю

// Черновик ответа не длиннее этого — чтобы влез в одно сообщение канала данных
const DRAFT_MAX = 4000
// Как часто ученик шлёт учителю набираемый текст
const DRAFT_INTERVAL_MS = 300
// Запасное обновление на случай потерянного сообщения
const POLL_MS = 15000
// «Ученики видят, что я открываю» — запоминаем в этом браузере
const FOLLOW_KEY = 'spirit.followTeacher'

function readFollow(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) !== 'off'
  } catch {
    return true
  }
}

// Ответы на уроке — в том же виде, что работа по уроку, чтобы показывать их теми же компонентами
function byStudent(list: CallAnswer[]): StudentHomework[] {
  const map = new Map<number, StudentHomework>()
  for (const a of list) {
    let sh = map.get(a.student)
    if (!sh) {
      sh = { id: a.student, student: a.student, student_name: a.student_name, description: '', task_answers: {}, files: [] }
      map.set(a.student, sh)
    }
    if (a.text) sh.task_answers![a.task] = a.text
    sh.files!.push(...a.files.map((f) => ({ id: f.id, name: f.name, url: f.url ?? undefined, task_key: a.task })))
  }
  return [...map.values()]
}

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
  // Учителю — что ученики печатают прямо сейчас: identity → {имя, задание, текст}
  const [drafts, setDrafts] = useState<Record<string, { name: string; task: string; text: string }>>({})
  // Учитель ведёт учеников: открытое им задание сразу открывается у всех
  const [follow, setFollow] = useState(readFollow)
  // Ответы на уроке (не ДЗ) и к какому уроку они загружены
  const [callAnswers, setCallAnswers] = useState<{ lesson: number; list: CallAnswer[] } | null>(null)
  const [error, setError] = useState('')

  // Во весь экран — только на компьютере: на телефоне панель и так на весь экран
  const panelRef = useRef<HTMLElement>(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const update = () => setFull(!!panelRef.current && document.fullscreenElement === panelRef.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void panelRef.current?.requestFullscreen?.().catch(() => {})
  }

  const lessonId = call.assignment
  const shownTask = call.shown_task

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

  const loadAnswers = useCallback(async () => {
    if (lessonId == null) return
    try {
      const list = await api.getCallAnswers(call.id)
      setCallAnswers({ lesson: lessonId, list: list.filter((a) => a.assignment === lessonId) })
    } catch {
      // попробуем при следующем обновлении
    }
  }, [call.id, lessonId])

  // Урок в созвоне сменился — ответы к нему
  useEffect(() => {
    if (lessonId == null) return
    let cancelled = false
    api
      .getCallAnswers(call.id)
      .then((list) => {
        if (!cancelled) setCallAnswers({ lesson: lessonId, list: list.filter((x) => x.assignment === lessonId) })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [call.id, lessonId])

  useEffect(() => {
    if (!isTeacher) return
    api.getAllAssignments().then(setLessons).catch(() => setLessons([]))
  }, [isTeacher])

  // Учителю ответы учеников приходят сигналом «answer» — обновляем не чаще раза в секунду
  const reloadTimer = useRef<number | undefined>(undefined)
  const scheduleReload = useCallback(() => {
    window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(() => void loadAnswers(), 500)
  }, [loadAnswers])
  useEffect(() => () => window.clearTimeout(reloadTimer.current), [])

  const shownRef = useRef({ lesson: lessonId, task: shownTask })
  useEffect(() => {
    shownRef.current = { lesson: lessonId, task: shownTask }
  })

  // force — пришёл сигнал от учителя; иначе это запасной опрос, и что-то делаем, только если задание сменилось
  const refreshCall = useCallback(
    async (force: boolean) => {
      try {
        const fresh = await api.getCall(call.id)
        const prev = shownRef.current
        const changed = fresh.assignment !== prev.lesson || fresh.shown_task !== prev.task
        if (!force && !changed) return
        if (changed) setOwnTask(null)
        onCallChange(fresh)
        if (fresh.shown_task) onOpen()
      } catch {
        // урок закончился — страница созвона закроется сама
      }
    },
    [call.id, onCallChange, onOpen],
  )

  const sendRef = useRef<(m: TasksMessage, to?: string[]) => void>(() => {})
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
        if (data.type === 'draft' && msg.from && typeof data.text === 'string') {
          const { identity, name } = msg.from
          const draft = { name: name || identity, task: String(data.task), text: data.text.slice(0, DRAFT_MAX) }
          setDrafts((prev) => ({ ...prev, [identity]: draft }))
        }
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
        void refreshCall(true)
      } else if (data.type === 'hello') {
        sendRef.current({ type: 'viewing', task: ownTaskRef.current })
      }
    },
    [isTeacher, scheduleReload, refreshCall],
  )
  const { send } = useDataChannel(TOPIC, onMessage)

  useEffect(() => {
    sendRef.current = (m, to) =>
      void send(encoder.encode(JSON.stringify(m)), { reliable: true, destinationIdentities: to }).catch(() => {})
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

  // Ученик шлёт набираемый ответ только учителям (метку ставит сервер в токене)
  const teacherIdsRef = useRef<string[]>([])
  useEffect(() => {
    teacherIdsRef.current = participants.filter((p) => !p.isLocal && p.metadata === 'teacher').map((p) => p.identity)
  })
  const draftTimer = useRef<number | undefined>(undefined)
  const draftPending = useRef<{ task: string; text: string } | null>(null)
  const handleDraft = useCallback((task: string, text: string) => {
    draftPending.current = { task, text: text.slice(0, DRAFT_MAX) }
    if (draftTimer.current !== undefined) return
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = undefined
      const draft = draftPending.current
      const to = teacherIdsRef.current
      if (draft && to.length) sendRef.current({ type: 'draft', ...draft }, to)
    }, DRAFT_INTERVAL_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(draftTimer.current), [])

  // Запасной опрос, пока вкладка видна: учителю — ответы, ученику — что показал учитель
  useEffect(() => {
    if (isTeacher && lessonId == null) return
    const timer = window.setInterval(() => {
      if (document.hidden) return
      if (isTeacher) void loadAnswers()
      else void refreshCall(false)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [isTeacher, lessonId, loadAnswers, refreshCall])

  // Урок сменили — старый, пока грузится новый, не показываем
  const lesson = loaded && loaded.id === lessonId ? loaded : null
  const tasks = useMemo(() => (lesson ? lessonTasks(lesson) : []), [lesson])
  const viewKey = ownTask ?? shownTask
  const current: LessonTask | undefined = tasks.find((t) => t.key === viewKey)
  const answersReady = callAnswers !== null && callAnswers.lesson === lessonId

  // Учителю под заданием — что ученики печатают сейчас (пока не совпало с сохранённым)
  const answers = useMemo(() => byStudent(answersReady ? callAnswers.list : []), [callAnswers, answersReady])
  const myAnswer = isTeacher ? undefined : answers[0]
  const live = current
    ? Object.entries(drafts).flatMap(([identity, d]) => {
        const student = Number(identity.replace('account-', ''))
        if (d.task !== current.key || !present.has(identity) || !Number.isFinite(student)) return []
        const saved = answers.find((sh) => sh.student === student)?.task_answers?.[current.key] ?? ''
        return d.text === saved ? [] : [{ student, name: d.name, text: d.text }]
      })
    : []
  const answeredCount = (key: string) => answers.filter((sh) => hasTaskAnswer(sh, key)).length

  function toggleFollow(on: boolean) {
    setFollow(on)
    try {
      localStorage.setItem(FOLLOW_KEY, on ? 'on' : 'off')
    } catch {
      // без памяти браузера — только на этот раз
    }
    if (on && current && current.key !== shownTask) void show(lessonId, current.key)
  }

  function openTask(key: string) {
    if (!isTeacher) {
      setOwnTask(key === shownTask ? null : key)
      return
    }
    setOwnTask(key)
    if (follow && key !== shownTask) void show(lessonId, key)
  }

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
    await api.saveCallAnswer(call.id, { task, text, files, deleteFileIds })
    await loadAnswers()
    sendRef.current({ type: 'answer' })
  }

  if (!open) return null

  return (
    <aside ref={panelRef} className={`${styles.panel} ${full ? styles.full : ''}`} aria-label="Задания урока">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h2 className={styles.title}>Задания</h2>
          {lesson && <p className={styles.subtitle}>{lesson.title} · {lesson.subject}</p>}
        </div>
        <div className={styles.headerButtons}>
          {document.fullscreenEnabled && (
            <button type="button" className={styles.fullButton} onClick={toggleFull}>
              {full ? 'Свернуть' : 'Во весь экран'}
            </button>
          )}
          {!full && (
            <button type="button" className={styles.close} onClick={onClose} aria-label="Скрыть задания">
              ✕
            </button>
          )}
        </div>
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
                onClick={() => openTask(t.key)}
              >
                {t.title} <span className={styles.chipGroup}>{t.group}</span>
                {isTeacher && answeredCount(t.key) > 0 && (
                  <span className={styles.chipCount} title="Сколько учеников ответили">
                    {answeredCount(t.key)}
                  </span>
                )}
                {t.key === shownTask && <span className={styles.shownDot} title="Это задание открыто у учеников" />}
              </button>
            ))}
          </div>
        )}

        {isTeacher && lesson && (
          <div className={styles.teacherActions}>
            <label className={styles.follow}>
              <input type="checkbox" checked={follow} onChange={(e) => toggleFollow(e.target.checked)} />
              Ученики видят, что я открываю
            </label>
            {!follow && current && current.key !== shownTask && (
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
            {current.source.trim() && (
              <FiguresContext.Provider value={lesson?.figures ?? []}>
                <LatexDocument source={current.source} files={current.files} taskNumber={current.number} />
              </FiguresContext.Provider>
            )}
            {isTeacher ? (
              <TaskAnswersList answers={answers} taskKey={current.key} live={live} showStatus={false} />
            ) : !answersReady ? (
              <p className={styles.note}>Загружаем ваш ответ…</p>
            ) : (
              <TaskAnswerForm
                key={`${lesson.id}-${current.key}`}
                answer={myAnswer}
                taskKey={current.key}
                onSave={handleSaveAnswer}
                onDraft={handleDraft}
              />
            )}
          </article>
        )}
      </div>
    </aside>
  )
}

export default CallTasks
