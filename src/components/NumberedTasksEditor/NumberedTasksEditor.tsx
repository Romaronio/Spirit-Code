import { useEffect, useState } from 'react'
import styles from './NumberedTasksEditor.module.css'
import LatexEditor from '../LatexEditor/LatexEditor'
import type { DocFile } from '../LatexDocument/LatexDocument'
import type { NumberedTask } from '../../types'
import { parseLatex } from '../../utils/latex'
import { taskNumberTitle } from '../../utils/taskNumbers'

interface Props {
  value: NumberedTask[]
  onChange: (tasks: NumberedTask[]) => void
  files?: DocFile[]
  pendingNames?: string[]
  inputClassName?: string
}

// В форме урока — только кнопка «Добавить номер» и плашки уже добавленных номеров.
// Сами задания редактируются в отдельном окне: слева вкладки номеров, справа LaTeX.
// Правки сразу уходят в форму, поэтому закрытие окна ничего не теряет
function NumberedTasksEditor({ value, onChange, files, pendingNames }: Props) {
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
              className={`${styles.chip} ${t.latex.trim() ? '' : styles.chipEmpty}`}
              title={describe(t.latex)}
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
  files?: DocFile[]
  pendingNames?: string[]
}

function NumberedTasksWindow({ value, onChange, current, onSelect, onClose, files, pendingNames }: WindowProps) {
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
    if (t.latex.trim() && !window.confirm(`Удалить ${taskNumberTitle(t.number)} вместе с его LaTeX?`)) return
    const rest = value.filter((x) => x.number !== t.number)
    onChange(rest)
    onSelect(rest[0]?.number ?? 0)
  }

  function handleLatex(latex: string) {
    onChange(value.map((t) => (t.number === current ? { ...t, latex } : t)))
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
                <span className={styles.tabStatus}>{describe(t.latex)}</span>
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
                  onChange={handleLatex}
                  files={files}
                  pendingNames={pendingNames}
                />
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

function describe(latex: string): string {
  if (!latex.trim()) return 'пусто — ученик не увидит'
  const count = parseLatex(latex).tasks
  return count ? `задач: ${count}` : 'есть текст'
}

export default NumberedTasksEditor
