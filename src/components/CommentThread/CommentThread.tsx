import { useEffect, useRef, useState, type FormEvent } from 'react'
import styles from './CommentThread.module.css'
import type { AnswerComment } from '../../types'
import MathText from '../MathText/MathText'
import { hasMath } from '../../utils/math'

interface Props {
  comments?: AnswerComment[]
  currentUserId?: number
  canDeleteAll?: boolean // учитель может удалить любое сообщение
  onSend: (text: string) => Promise<void>
  onEdit: (commentId: number, text: string) => Promise<void>
  onDelete: (commentId: number) => Promise<void>
  placeholder?: string
  // Режим окна чата: занимает всю высоту родителя, сообщения прокручиваются,
  // поле ввода прижато к низу, при новых сообщениях — прокрутка вниз
  fill?: boolean
  emptyText?: string
}

// Кнопки-шаблоны для формул. caret — куда встанет курсор после вставки
const MATH_TEMPLATES = [
  { label: '$…$', title: 'Формула в тексте', snippet: '', caret: 0 },
  { label: 'a/b', title: 'Дробь', snippet: '\\frac{}{}', caret: 6 },
  { label: '√', title: 'Корень', snippet: '\\sqrt{}', caret: 6 },
  { label: 'xⁿ', title: 'Степень', snippet: '^{}', caret: 2 },
  { label: 'xₙ', title: 'Индекс', snippet: '_{}', caret: 2 },
  { label: '·', title: 'Умножение', snippet: '\\cdot ', caret: 6 },
  { label: '±', title: 'Плюс-минус', snippet: '\\pm ', caret: 4 },
  { label: '≤', title: 'Меньше или равно', snippet: '\\le ', caret: 4 },
  { label: '≥', title: 'Больше или равно', snippet: '\\ge ', caret: 4 },
  { label: '≠', title: 'Не равно', snippet: '\\ne ', caret: 4 },
  { label: 'π', title: 'Пи', snippet: '\\pi ', caret: 4 },
  { label: '∞', title: 'Бесконечность', snippet: '\\infty ', caret: 7 },
  { label: '°', title: 'Градус', snippet: '^\\circ', caret: 6 },
]

// Курсор внутри формулы, если перед ним нечётное число неэкранированных $
function isInsideMath(before: string) {
  return (before.match(/(?<!\\)\$/g)?.length ?? 0) % 2 === 1
}

// Сколько держать палец на сообщении, чтобы открылось меню (телефон)
const LONG_PRESS_MS = 600

function formatTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

interface Menu {
  comment: AnswerComment
  x: number
  y: number
}

// Переписка учителя и ученика по одному ответу.
// Меню «Изменить / Удалить»: правая кнопка мыши или долгое нажатие на телефоне.
function CommentThread({
  comments = [],
  currentUserId,
  canDeleteAll = false,
  onSend,
  onEdit,
  onDelete,
  placeholder = 'Написать сообщение...',
  fill = false,
  emptyText,
}: Props) {
  const [text, setText] = useState('')
  const [showMathBar, setShowMathBar] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')

  const [menu, setMenu] = useState<Menu | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const pressTimer = useRef<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)

  // В окне чата держим прокрутку у последнего сообщения
  useEffect(() => {
    if (!fill) return
    const el = messagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [fill, comments.length])
  // Когда открыли меню: после долгого нажатия браузер может прислать «клик»
  // при отпускании пальца — он не должен сразу закрыть меню
  const menuOpenedAt = useRef(0)

  const canEdit = (c: AnswerComment) => c.author === currentUserId
  const canDelete = (c: AnswerComment) => c.author === currentUserId || canDeleteAll

  // Меню закрывается по клику мимо, Escape, прокрутке и изменению размера окна
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (e.type === 'mousedown' || e.type === 'touchstart') {
        if (menuRef.current?.contains(e.target as Node)) return
        if (e.timeStamp - menuOpenedAt.current < 400) return
      }
      setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // openedAt — время события, открывшего меню (в той же шкале, что event.timeStamp)
  function openMenu(comment: AnswerComment, x: number, y: number, openedAt: number) {
    if (!canEdit(comment) && !canDelete(comment)) return
    // Не даём меню вылезти за правый/нижний край экрана
    const width = 160
    const height = 96
    menuOpenedAt.current = openedAt
    setMenu({
      comment,
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    })
  }

  function cancelPress() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  function startPress(comment: AnswerComment, e: React.TouchEvent) {
    cancelPress()
    const touch = e.touches[0]
    const { clientX, clientY } = touch
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null
      navigator.vibrate?.(20) // лёгкая отдача на Android
      openMenu(comment, clientX, clientY, performance.now())
    }, LONG_PRESS_MS)
  }

  // Вставка шаблона формулы в позицию курсора. Если курсор не внутри $...$ —
  // шаблон сам оборачивается в $...$
  function insertTemplate(snippet: string, caret: number) {
    const el = inputRef.current
    if (!el) return
    const start = el.selectionStart
    const before = text.slice(0, start)
    const after = text.slice(el.selectionEnd)
    const wrap = !isInsideMath(before)
    const insertion = wrap ? `$${snippet}$` : snippet
    const position = start + caret + (wrap ? 1 : 0)
    setText(before + insertion + after)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(position, position)
    })
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (text.trim() === '') return
    setIsSending(true)
    setError('')
    try {
      await onSend(text.trim())
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить сообщение')
    } finally {
      setIsSending(false)
    }
  }

  function startEdit(comment: AnswerComment) {
    setMenu(null)
    setEditingId(comment.id)
    setEditText(comment.text)
    setError('')
  }

  async function saveEdit() {
    if (editingId === null || editText.trim() === '') return
    setIsSaving(true)
    setError('')
    try {
      await onEdit(editingId, editText.trim())
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить сообщение')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(comment: AnswerComment) {
    setMenu(null)
    if (!window.confirm('Удалить сообщение?')) return
    setError('')
    try {
      await onDelete(comment.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить сообщение')
    }
  }

  return (
    <div className={`${styles.thread} ${fill ? styles.fill : ''}`}>
      <div ref={messagesRef} className={styles.scroll}>
        {comments.length === 0 && emptyText && <p className={styles.emptyText}>{emptyText}</p>}
        {comments.length > 0 && (
          <ul className={styles.messages}>
            {comments.map((c) => {
              const interactive = canEdit(c) || canDelete(c)
              const isEditing = editingId === c.id

              return (
                <li
                  key={c.id}
                  className={[
                    styles.message,
                    c.author_role === 'teacher' ? styles.teacher : '',
                    interactive ? styles.interactive : '',
                    menu?.comment.id === c.id ? styles.selected : '',
                  ].join(' ')}
                  onContextMenu={(e) => {
                    if (!interactive || isEditing) return
                    e.preventDefault()
                    cancelPress()
                    openMenu(c, e.clientX, e.clientY, e.timeStamp)
                  }}
                  onTouchStart={interactive && !isEditing ? (e) => startPress(c, e) : undefined}
                  onTouchMove={cancelPress}
                  onTouchEnd={cancelPress}
                  onTouchCancel={cancelPress}
                >
                  <div className={styles.meta}>
                    <span className={styles.author}>
                      {c.author_role === 'teacher' ? `Учитель · ${c.author_name}` : c.author_name}
                    </span>
                    <span className={styles.time}>
                      {c.edited_at && <span className={styles.edited}>изменено · </span>}
                      {formatTime(c.created_at)}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className={styles.editor}>
                      <textarea
                        className={styles.input}
                        rows={2}
                        maxLength={2000}
                        value={editText}
                        autoFocus
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault()
                            saveEdit()
                          }
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                      {hasMath(editText) && (
                        <div className={styles.preview}>
                          <span className={styles.previewLabel}>Предпросмотр</span>
                          <MathText text={editText} className={styles.text} />
                        </div>
                      )}
                      <div className={styles.editActions}>
                        <button
                          type="button"
                          className={styles.send}
                          onClick={saveEdit}
                          disabled={isSaving || editText.trim() === ''}
                        >
                          {isSaving ? '...' : 'Сохранить'}
                        </button>
                        <button
                          type="button"
                          className={styles.cancel}
                          onClick={() => setEditingId(null)}
                          disabled={isSaving}
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className={styles.text}>
                      <MathText text={c.text} />
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {menu && (
        <div
          ref={menuRef}
          className={styles.menu}
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          {canEdit(menu.comment) && (
            <button type="button" role="menuitem" onClick={() => startEdit(menu.comment)}>
              ✎ Изменить
            </button>
          )}
          {canDelete(menu.comment) && (
            <button
              type="button"
              role="menuitem"
              className={styles.danger}
              onClick={() => handleDelete(menu.comment)}
            >
              🗑 Удалить
            </button>
          )}
        </div>
      )}

      <div className={styles.composer}>
        {showMathBar && (
          <div className={styles.mathBar} role="toolbar" aria-label="Шаблоны формул">
            {MATH_TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                className={styles.mathButton}
                title={t.title}
                // mousedown не забирает фокус у поля ввода — курсор остаётся на месте
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertTemplate(t.snippet, t.caret)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {hasMath(text) && (
          <div className={styles.preview}>
            <span className={styles.previewLabel}>Предпросмотр</span>
            <MathText text={text} className={styles.text} />
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <button
            type="button"
            className={`${styles.mathToggle} ${showMathBar ? styles.mathToggleActive : ''}`}
            onClick={() => setShowMathBar((v) => !v)}
            aria-pressed={showMathBar}
            title="Формулы (LaTeX): $...$ — в строке, $$...$$ — отдельной строкой"
          >
            ∑
          </button>
          <textarea
            ref={inputRef}
            className={styles.input}
            rows={2}
            maxLength={2000}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl/Cmd + Enter — отправить
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <button type="submit" className={styles.send} disabled={isSending || text.trim() === ''}>
            {isSending ? '...' : 'Отправить'}
          </button>
        </form>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  )
}

export default CommentThread
