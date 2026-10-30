import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import styles from './ChatWindow.module.css'
import type { Assignment, CommentActions, StudentHomework } from '../../types'
import { StatusBadge } from '../AnswerStatus/AnswerStatus'
import CommentThread from '../CommentThread/CommentThread'

interface Props {
  assignment: Assignment
  answer: StudentHomework
  currentUserId?: number
  commentActions: CommentActions
  onClose: () => void
}

// Окно переписки учителя с учеником по одному ответу.
// Открывается на странице учителя вместо колонки с заданиями.
function ChatWindow({ assignment, answer, currentUserId, commentActions, onClose }: Props) {
  const ref = useRef<HTMLElement>(null)

  // На телефоне колонки идут друг под другом — прокручиваем к открытому чату
  // (1100px — та же граница, что в HomePage.module.css)
  useEffect(() => {
    if (window.matchMedia('(max-width: 1100px)').matches) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [answer.id])

  // Esc закрывает окно. Но если открыто меню сообщения или идёт правка
  // в поле ввода — Esc относится к ним, а окно остаётся
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (e.target instanceof HTMLTextAreaElement) return
      if (ref.current?.querySelector('[role="menu"]')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section
      ref={ref}
      className={styles.window}
      aria-label={`Переписка с ${answer.student_name}`}
    >
      <header className={styles.header}>
        <div className={styles.titles}>
          <h2 className={styles.name}>{answer.student_name}</h2>
          <div className={styles.meta}>
            <Link to={`/assignment/${assignment.id}`} className={styles.assignment}>
              {assignment.title}
            </Link>
            <span className={styles.subject}>{assignment.subject}</span>
            <StatusBadge status={answer.status} />
          </div>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть переписку">
          ✕
        </button>
      </header>

      <div className={styles.chat}>
        <CommentThread
          fill
          comments={answer.comments}
          currentUserId={currentUserId}
          canDeleteAll
          emptyText="Сообщений пока нет — напишите ученику первым"
          placeholder="Ответить ученику..."
          onSend={(text) => commentActions.add(assignment.id!, answer.id!, text)}
          onEdit={(id, text) => commentActions.edit(assignment.id!, answer.id!, id, text)}
          onDelete={(id) => commentActions.remove(assignment.id!, answer.id!, id)}
        />
      </div>
    </section>
  )
}

export default ChatWindow
