import { useEffect, useRef } from 'react'
import styles from './TasksViewer.module.css'
import LatexDocument, { type DocFile } from '../LatexDocument/LatexDocument'

interface Props {
  title: string
  subtitle?: string
  source: string
  files?: DocFile[]
  onClose: () => void
}

// Совпадает с @media в TasksViewer.module.css: уже — панель на весь экран
const FULLSCREEN_QUERY = '(max-width: 1000px)'

// Задания в панели справа от задания — вместо скачивания PDF
function TasksViewer({ title, subtitle, source, files, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Esc закрывает
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Новый документ — с начала; во весь экран страница под панелью не прокручивается
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
    if (!window.matchMedia(FULLSCREEN_QUERY).matches) return
    closeRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [source])

  return (
    <aside className={styles.panel} aria-label={title}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{title}</h2>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </header>
      <div ref={bodyRef} className={styles.body}>
        <LatexDocument source={source} files={files} />
      </div>
    </aside>
  )
}

export default TasksViewer
