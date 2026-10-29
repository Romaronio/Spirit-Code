import { useEffect, useRef, useState } from 'react'
import styles from './NumberedTasksEditor.module.css'
import LatexEditor from '../LatexEditor/LatexEditor'
import type { DocFile } from '../LatexDocument/LatexDocument'
import type { NumberedTask } from '../../types'
import { parseLatex } from '../../utils/latex'
import { taskNumberTitle } from '../../utils/taskNumbers'
import { ACCEPT, EMPTY_TASK_FILES, pickFiles, type TaskFilesDraft } from '../../utils/uploads'

// Сохранённый файл урока или ДЗ; с task_number — файл к этому номеру
type AttachedFile = DocFile & { id?: number | string; task_number?: number | null }

interface Props {
  value: NumberedTask[]
  onChange: (tasks: NumberedTask[]) => void
  files?: AttachedFile[]
  pendingNames?: string[]
  inputClassName?: string
  taskFiles?: TaskFilesDraft // без него в окне нет раздела с файлами к номеру
  onTaskFilesChange?: (draft: TaskFilesDraft) => void
}

// В форме урока — только кнопка «Добавить номер» и плашки уже добавленных номеров.
// Сами задания редактируются в отдельном окне: слева вкладки номеров, справа LaTeX.
// Правки сразу уходят в форму, поэтому закрытие окна ничего не теряет
function NumberedTasksEditor({ value, onChange, files, pendingNames, taskFiles, onTaskFilesChange }: Props) {
  // null — окно закрыто, иначе номер открытой вкладки (0 — пока нет номеров)
  const [openNumber, setOpenNumber] = useState<number | null>(null)

  function openNew() {
    const number = suggestNumber(value)
    if (!value.some((t) => t.number === number)) {
      onChange(sortTasks([...value, { number, latex: '' }]))
    }
    setOpenNumber(number)
  }

  return (
    <div className={styles.wrap}>
      {value.length > 0 && (
        <div className={styles.chips}>
          {value.map((t) => (
            <button
              key={t.number}
              type="button"
              className={`${styles.chip} ${isEmpty(t, countFiles(t.number, files, taskFiles)) ? styles.chipEmpty : ''}`}
              title={describe(t, countFiles(t.number, files, taskFiles))}
              onClick={() => setOpenNumber(t.number)}
            >
              {taskNumberTitle(t.number)}
            </button>
          ))}
        </div>
      )}
      <button type="button" className={styles.add} onClick={openNew}>
        + Добавить номер
      </button>

      {openNumber !== null && (
        <NumberedTasksWindow
          value={value}
          onChange={onChange}
          current={openNumber}
          onSelect={setOpenNumber}
          onClose={() => setOpenNumber(null)}
          files={files}
          pendingNames={pendingNames}
          taskFiles={taskFiles}
          onTaskFilesChange={onTaskFilesChange}
        />
      )}
    </div>
  )
}

interface WindowProps {
  value: NumberedTask[]
  onChange: (tasks: NumberedTask[]) => void
  current: number
  onSelect: (number: number) => void
  onClose: () => void
  files?: AttachedFile[]
  pendingNames?: string[]
  taskFiles?: TaskFilesDraft
  onTaskFilesChange?: (draft: TaskFilesDraft) => void
}

function NumberedTasksWindow({
  value, onChange, current, onSelect, onClose, files, pendingNames, taskFiles, onTaskFilesChange,
}: WindowProps) {
  const [newNumber, setNewNumber] = useState('')
  const [error, setError] = useState('')
  const task = value.find((t) => t.number === current)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // Страница под окном не прокручивается
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  function handleAdd() {
    const number = newNumber.trim() === '' ? suggestNumber(value) : Number(newNumber)
    if (!Number.isInteger(number) || number < 1 || number > 999) {
      setError('Номер — целое число от 1 до 999')
      return
    }
    if (value.some((t) => t.number === number)) {
      setError(`${taskNumberTitle(number)} уже есть — открыл его`)
      onSelect(number)
      return
    }
    onChange(sortTasks([...value, { number, latex: '' }]))
    onSelect(number)
    setNewNumber('')
    setError('')
  }

  function handleRemove(t: NumberedTask) {
    const hasContent = !isEmpty(t, countFiles(t.number, files, taskFiles)) || t.answer?.trim()
    if (hasContent && !window.confirm(`Удалить ${taskNumberTitle(t.number)} вместе с его LaTeX, ответом и файлами?`)) return
    const rest = value.filter((x) => x.number !== t.number)
    onChange(rest)
    onSelect(rest[0]?.number ?? 0)
    // Новые файлы номера больше не нужны; сохранённые сервер удалит вместе с номером
    if (taskFiles?.added[t.number]) {
      const added = { ...taskFiles.added }
      delete added[t.number]
      onTaskFilesChange?.({ ...taskFiles, added })
    }
  }

  // Распознавание фото возвращает текст через несколько секунд — за это время учитель
  // мог поправить другие номера, поэтому правим свежий список, а не тот, что был при вызове
  const latestValue = useRef(value)
  useEffect(() => {
    latestValue.current = value
  }, [value])

  function handleLatex(number: number, latex: string) {
    const next = latestValue.current.map((t) => (t.number === number ? { ...t, latex } : t))
    latestValue.current = next
    onChange(next)
  }

  function handleAnswer(number: number, answer: string) {
    const next = latestValue.current.map((t) => (t.number === number ? { ...t, answer } : t))
    latestValue.current = next
    onChange(next)
  }

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.window} role="dialog" aria-modal="true" aria-label="Задания по номерам">
        <div className={styles.windowHeader}>
          <h2>Задания по номерам</h2>
          <button type="button" className={styles.done} onClick={onClose}>
            Готово
          </button>
        </div>

        <div className={styles.body}>
          <nav className={styles.tabs}>
            {value.map((t) => (
              <button
                key={t.number}
                type="button"
                className={`${styles.tab} ${t.number === current ? styles.tabActive : ''}`}
                onClick={() => onSelect(t.number)}
              >
                <span className={styles.tabTitle}>{taskNumberTitle(t.number)}</span>
                <span className={styles.tabStatus}>{describe(t, countFiles(t.number, files, taskFiles))}</span>
              </button>
            ))}
            <div className={styles.addRow}>
              <input
                type="number"
                min={1}
                max={999}
                placeholder={String(suggestNumber(value))}
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAdd()
                  }
                }}
              />
              <button type="button" className={styles.add} onClick={handleAdd}>
                + Номер
              </button>
            </div>
            {error && <p className={styles.error}>{error}</p>}
          </nav>

          <div className={styles.content}>
            {task ? (
              <>
                <div className={styles.contentHeader}>
                  <h3>{taskNumberTitle(task.number)}</h3>
                  <button type="button" className={styles.remove} onClick={() => handleRemove(task)}>
                    Удалить номер
                  </button>
                </div>
                <LatexEditor
                  key={task.number}
                  label="LaTeX задания — у ученика будет отдельная кнопка"
                  value={task.latex}
                  onChange={(latex) => handleLatex(task.number, latex)}
                  files={files}
                  pendingNames={pendingNames}
                />
                <label className={styles.field}>
                  Ответ — видит только учитель
                  <input
                    type="text"
                    maxLength={500}
                    placeholder="Например, 42"
                    value={task.answer ?? ''}
                    onChange={(e) => handleAnswer(task.number, e.target.value)}
                  />
                </label>
                {taskFiles && onTaskFilesChange && (
                  <TaskFilesSection
                    number={task.number}
                    saved={(files ?? []).filter((f) => f.task_number === task.number)}
                    draft={taskFiles}
                    onChange={onTaskFilesChange}
                  />
                )}
              </>
            ) : (
              <p className={styles.hint}>Добавьте номер слева.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function sortTasks(tasks: NumberedTask[]): NumberedTask[] {
  return [...tasks].sort((a, b) => a.number - b.number)
}

// Следующий номер после самого большого из добавленных
function suggestNumber(tasks: NumberedTask[]): number {
  const max = Math.max(0, ...tasks.map((t) => t.number))
  return Math.min(max + 1, 999)
}

function describe(task: NumberedTask, fileCount: number): string {
  const parts = []
  if (task.latex.trim()) {
    const count = parseLatex(task.latex).tasks
    parts.push(count ? `задач: ${count}` : 'есть текст')
  }
  if (fileCount) parts.push(`файлов: ${fileCount}`)
  if (task.answer?.trim()) parts.push('есть ответ')
  if (!task.latex.trim() && !fileCount) parts.push('ученик не увидит')
  return parts.join(', ')
}

// Сколько файлов будет у номера после сохранения
function countFiles(number: number, files: AttachedFile[] | undefined, draft: TaskFilesDraft = EMPTY_TASK_FILES) {
  const saved = (files ?? []).filter(
    (f) => f.task_number === number && (f.id === undefined || !draft.removed.includes(f.id))
  ).length
  return saved + (draft.added[number]?.length ?? 0)
}

// Ученик видит номер, если у него есть LaTeX или файлы
function isEmpty(task: NumberedTask, fileCount: number) {
  return !task.latex.trim() && fileCount === 0
}

// Файлы для выполнения номера: сохранённые (их можно убрать) и только что выбранные
function TaskFilesSection({ number, saved, draft, onChange }: {
  number: number
  saved: AttachedFile[]
  draft: TaskFilesDraft
  onChange: (draft: TaskFilesDraft) => void
}) {
  const [error, setError] = useState('')
  const kept = saved.filter((f) => f.id === undefined || !draft.removed.includes(f.id))
  const added = draft.added[number] ?? []

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const { entries, error } = pickFiles(e.target.files)
    onChange({ ...draft, added: { ...draft.added, [number]: [...added, ...entries] } })
    setError(error)
    e.target.value = ''
  }

  return (
    <div className={styles.field}>
      Файлы для выполнения — ученик скачает их в окне номера
      {(kept.length > 0 || added.length > 0) && (
        <ul className={styles.fileList}>
          {kept.map((f) => (
            <li key={f.id}>
              <a href={f.url} download={f.name}>📎 {f.name}</a>
              <button
                type="button"
                className={styles.remove}
                onClick={() => f.id !== undefined && onChange({ ...draft, removed: [...draft.removed, f.id] })}
              >
                Убрать
              </button>
            </li>
          ))}
          {added.map((f) => (
            <li key={f.id}>
              <span>📎 {f.name} <span className={styles.hint}>· новый</span></span>
              <button
                type="button"
                className={styles.remove}
                onClick={() => onChange({ ...draft, added: { ...draft.added, [number]: added.filter((x) => x.id !== f.id) } })}
              >
                Убрать
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={styles.fileButton}>
        📎 Прикрепить файлы
        <input type="file" multiple accept={ACCEPT} className={styles.hiddenInput} onChange={handlePick} />
      </label>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

export default NumberedTasksEditor
