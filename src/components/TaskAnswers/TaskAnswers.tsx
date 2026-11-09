import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './TaskAnswers.module.css'
import { StatusBadge } from '../AnswerStatus/AnswerStatus'
import CodeRunner from '../CodeRunner/CodeRunner'
import { ACCEPT, pickFiles, type FileEntry } from '../../utils/uploads'
import { hasTaskAnswer, joinTaskAnswer, splitTaskAnswer } from '../../utils/lessonTasks'
import type { StudentHomework } from '../../types'

// Ответы учеников к отдельным заданиям урока — на странице урока и в созвоне.
// Ключ задания как в StudentHomework.task_answers: 'cw-5', 'hw-3', 'classwork', 'homework'

// Ответ ученика к одному заданию: текст и файлы
// liveText — то, что ученик печатает прямо сейчас (в созвоне), вместо сохранённого текста
export function TaskAnswerContent({ answer, taskKey, liveText }: { answer: StudentHomework; taskKey: string; liveText?: string }) {
  const { answer: text, code } = splitTaskAnswer(liveText ?? answer.task_answers?.[taskKey])
  const files = (answer.files ?? []).filter((f) => f.task_key === taskKey)
  // Пока ученик печатает, результат проверки относится к старому ответу — не показываем
  const check = liveText === undefined ? answer.task_checks?.[taskKey] : undefined
  return (
    <>
      {text.trim() ? (
        <p className={styles.answerText}>
          <span className={styles.answerLabel}>Ответ:</span> <strong>{text}</strong>
          {check !== undefined && <> <CheckMark ok={check} /></>}
        </p>
      ) : (
        check === false && (
          <p className={styles.answerText}>
            <CheckMark ok={false} label="краткого ответа нет" />
          </p>
        )
      )}
      {code.trim() && (
        <div className={styles.codeView}>
          <span className={styles.answerLabel}>Программа</span>
          <pre className={styles.code}>{code}</pre>
          {liveText === undefined && <CodeRunner code={code} />}
        </div>
      )}
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

// Результат автопроверки краткого ответа
export function CheckMark({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className={ok ? styles.checkOk : styles.checkBad}>{ok ? '✓ верно' : `✗ ${label ?? 'неверно'}`}</span>
  )
}

// Набираемый учеником ответ, ещё не сохранённый
export interface LiveAnswer {
  student: number
  name: string
  text: string
}

function Typing() {
  return <span className={styles.typing}>✎ печатает…</span>
}

// Учителю под заданием — ответы всех учеников к нему; live — что ученики печатают сейчас (в созвоне)
// showStatus: false — ответы на уроке в созвоне, их не проверяют
export function TaskAnswersList({
  answers,
  taskKey,
  live = [],
  showStatus = true,
}: {
  answers: StudentHomework[]
  taskKey: string
  live?: LiveAnswer[]
  showStatus?: boolean
}) {
  const liveBy = new Map(live.map((l) => [l.student, l]))
  const answered = answers.filter((sh) => hasTaskAnswer(sh, taskKey) || (sh.student != null && liveBy.has(sh.student)))
  const onlyLive = live.filter((l) => !answers.some((sh) => sh.student === l.student))
  return (
    <section className={styles.taskAnswerBox}>
      <h3>Ответы учеников</h3>
      {answered.length + onlyLive.length > 0 ? (
        <ul className={styles.studentHomeworks}>
          {answered.map((sh) => {
            const typing = sh.student != null ? liveBy.get(sh.student) : undefined
            return (
              <li key={sh.id} className={styles.studentHomeworkCard}>
                <span className={styles.studentName}>
                  {sh.student_name} {typing ? <Typing /> : showStatus && <StatusBadge answer={sh} />}
                </span>
                <TaskAnswerContent answer={sh} taskKey={taskKey} liveText={typing?.text} />
              </li>
            )
          })}
          {onlyLive.map((l) => (
            <li key={`live-${l.student}`} className={styles.studentHomeworkCard}>
              <span className={styles.studentName}>
                {l.name} <Typing />
              </span>
              {l.text && (
                <TaskAnswerContent answer={{ student: l.student, description: '', files: [] }} taskKey={taskKey} liveText={l.text} />
              )}
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
  shortOnly?: boolean // учитель просит только краткий ответ — без программы и файлов
  detailedRequired?: boolean // без программы или файла ДЗ не отправить
  onSave: (task: string, text: string, files: File[], deleteFileIds: Array<number | string>) => Promise<void>
  // Текст по мере набора, ещё до сохранения (в созвоне — учителю вживую)
  onDraft?: (task: string, text: string) => void
}

// Пауза после ввода, после которой ответ сохраняется сам
const AUTOSAVE_DELAY_MS = 1000

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// Ученику под заданием — ответ к этому заданию: текст и файлы.
// Кнопки «Сохранить» нет: текст сохраняется после паузы в вводе, файлы — сразу
export function TaskAnswerForm({ answer, taskKey, shortOnly, detailedRequired, onSave, onDraft }: TaskAnswerFormProps) {
  const [parts, setParts] = useState(() => splitTaskAnswer(answer?.task_answers?.[taskKey]))
  const text = joinTaskAnswer(parts)
  const [uploading, setUploading] = useState<FileEntry[]>([])
  const [deletedIds, setDeletedIds] = useState<Array<number | string>>([])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState('')

  // Текст, который уже в БД, и текущий — для сохранения при закрытии задания
  const [initialText] = useState(answer?.task_answers?.[taskKey] ?? '')
  const savedTextRef = useRef(initialText)
  const textRef = useRef(initialText)
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

  // Результат автопроверки — после «Отправить ответ» и пока ученик не изменил краткий ответ
  const check = answer?.task_checks?.[taskKey]
  const showCheck =
    check !== undefined && parts.answer.trim() === splitTaskAnswer(answer?.task_answers?.[taskKey]).answer.trim()

  const savedFiles = (answer?.files ?? []).filter(
    (f) => f.task_key === taskKey && (f.id === undefined || !deletedIds.includes(f.id))
  )

  function handleChange(changes: Partial<typeof parts>) {
    const next = { ...parts, ...changes }
    const value = joinTaskAnswer(next)
    textRef.current = value
    setParts(next)
    onDraft?.(taskKey, value)
  }

  // Tab в поле программы — отступ, а не переход к следующему полю
  function handleCodeKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart: start, selectionEnd: end } = el
    const code = parts.code.slice(0, start) + '    ' + parts.code.slice(end)
    handleChange({ code })
    requestAnimationFrame(() => el.setSelectionRange(start + 4, start + 4))
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
      {detailedRequired && !shortOnly && (
        <p className={styles.required}>
          Развёрнутый ответ обязателен: вставьте программу или прикрепите файл — без этого домашнее задание не отправить
        </p>
      )}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Ответ</span>
        <input
          type="text"
          className={styles.input}
          placeholder={shortOnly ? 'Только краткий ответ, например: 42' : 'Например: 42'}
          value={parts.answer}
          onChange={(e) => handleChange({ answer: e.target.value })}
          onBlur={() => save().catch(() => {})}
        />
      </label>
      {showCheck && (
        <p className={check ? styles.checkResultOk : styles.checkResultBad}>
          {check ? '✓ Ответ верный' : '✗ Ответ неверный — исправьте его и снова нажмите «Отправить ответ»'}
        </p>
      )}
      {/* Только краткий ответ — без программы и файлов (так решил учитель) */}
      {!shortOnly && (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Программа</span>
            <textarea
              className={`${styles.textarea} ${styles.codeInput}`}
              rows={8}
              placeholder="Вставьте сюда код решения"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={parts.code}
              onChange={(e) => handleChange({ code: e.target.value })}
              onKeyDown={handleCodeKeyDown}
              onBlur={() => save().catch(() => {})}
            />
          </label>
          <CodeRunner code={parts.code} />
          <label className={styles.fileButton}>
            📎 Прикрепить файлы
            <input type="file" multiple accept={ACCEPT} className={styles.hiddenInput} onChange={handleFilesChange} />
          </label>
        </>
      )}
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
