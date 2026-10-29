import { useEffect, useRef } from 'react'
import styles from './TasksViewer.module.css'
import LatexDocument, { type DocFile } from '../LatexDocument/LatexDocument'

interface Props {
  title: string
  subtitle?: string
  source: string
  files?: DocFile[]
  attachments?: DocFile[] // файлы для выполнения номера — ученик скачивает их здесь
  answer?: string // ответ к номеру, передаётся только учителю
  onClose: () => void
  onNext?: () => void // открыть следующее задание; нет — значит, это последнее
}

// Совпадает с @media в TasksViewer.module.css: уже — панель на весь экран
const FULLSCREEN_QUERY = '(max-width: 1000px)'

// Задания в панели справа от задания — вместо скачивания PDF
function TasksViewer({ title, subtitle, source, files, attachments = [], answer, onClose, onNext }: Props) {
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
        {answer?.trim() && (
          <p className={styles.answer}>
            Ответ: <strong>{answer}</strong> <span className={styles.answerNote}>· видите только вы</span>
          </p>
        )}
        {attachments.length > 0 && (
          <div className={styles.attachments}>
            <p className={styles.attachmentsTitle}>Файлы для выполнения</p>
            <ul>
              {attachments.map((f) => (
                <li key={f.name + f.url}>
                  <a href={f.url} download={f.name}>📎 {f.name}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {source.trim() && <LatexDocument source={source} files={files} />}
        {onNext && (
          <button type="button" className={styles.next} onClick={onNext}>
            Следующее задание →
          </button>
        )}
      </div>
    </aside>
  )
}

export default TasksViewer
