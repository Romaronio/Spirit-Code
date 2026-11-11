import { useEffect, useRef, useState } from 'react'
import styles from './SubjectSwitcher.module.css'

export interface SubjectOption {
  name: string
  total: number // уроков по предмету
  todo: number // ученику — ждут решения, учителю — ответы ждут проверки
}

interface Props {
  options: SubjectOption[]
  value: string
  onChange: (name: string) => void
  todoLabel?: string // подпись к todo в списке
}

// Кнопка с выпадающим списком предметов ученика на главной: уроки и прогресс показываются по выбранному
function SubjectSwitcher({ options, value, onChange, todoLabel = 'ждут решения' }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Закрываем по клику мимо и по Esc
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.button}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.value}>{value}</span>
        <span className={styles.chevron} aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul className={styles.menu} role="listbox" aria-label="Предметы">
          {options.map((o) => (
            <li key={o.name}>
              <button
                type="button"
                role="option"
                aria-selected={o.name === value}
                className={`${styles.option} ${o.name === value ? styles.active : ''}`}
                onClick={() => {
                  onChange(o.name)
                  setOpen(false)
                }}
              >
                <span className={styles.optionName}>{o.name}</span>
                <span className={styles.optionMeta}>
                  {o.total === 0 ? 'уроков пока нет' : o.todo > 0 ? `${todoLabel}: ${o.todo}` : `уроков: ${o.total}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default SubjectSwitcher
