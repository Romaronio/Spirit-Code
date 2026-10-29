import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import styles from './HomePage.module.css'
import type { Account, Assignment, CommentActions, NewAssignment, ReviewStatus, User } from '../../types'
import AssignmentCard from '../../components/AssignmentCard/AssignmentCard'
import AssignmentForm from '../../components/AssignmentForm/AssignmentForm'
import StudentsPanel from '../../components/StudentsPanel/StudentsPanel'
import AnswersPanel from '../../components/AnswersPanel/AnswersPanel'
import ProgressDonut from '../../components/ProgressDonut/ProgressDonut'
import PaymentsPanel from '../../components/PaymentsPanel/PaymentsPanel'
import BankTaskForm from '../../components/BankTaskForm/BankTaskForm'
import ChatWindow from '../../components/ChatWindow/ChatWindow'
import { hasSubject, normalize, subjectsOf } from '../../utils/subjects'

interface Props {
  user: User | null;
  onLogout: () => void;
  items: Assignment[];
  accounts: Account[];
  onDelete: (id: number) => void;
  onAddStudent: (student: Omit<Account, 'id'>) => Promise<void>;
  onDeleteStudent: (id: number) => void;
  onSetSubjects: (id: number, subjects: string[]) => void;
  onReview: (assignmentId: number, answerId: number, status: ReviewStatus) => Promise<void>;
  commentActions: CommentActions;
  onAdd: (data: NewAssignment) => Promise<void>;
}

function HomePage({
  user,
  onLogout,
  items,
  onAdd,
  onDelete,
  accounts,
  onAddStudent,
  onDeleteStudent,
  onSetSubjects,
  onReview,
  commentActions,
}: Props) {
  // Открытая переписка (у учителя): показывается вместо колонки с заданиями
  const [openChat, setOpenChat] = useState<{ assignmentId: number; answerId: number } | null>(null)
  const closeChat = useCallback(() => setOpenChat(null), [])

  // Чат по высоте равен панели «Ответы учеников» — следим за её размером
  const answersRef = useRef<HTMLElement>(null)
  const [answersHeight, setAnswersHeight] = useState<number>()
  const isChatOpen = openChat !== null
  useEffect(() => {
    const el = answersRef.current
    if (!el || !isChatOpen) return
    const observer = new ResizeObserver(() => setAnswersHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [isChatOpen])

  if (!user) {
    return <Navigate to="/" replace />
  }

  const isTeacher = user.role === 'teacher'

  // Предметы ученика берём из актуального списка аккаунтов,
  // чтобы изменения учителя применялись сразу
  const account = accounts.find((a) => normalize(a.name) === normalize(user.name))
  const mySubjects = account?.subjects ?? []

  const visibleItems = isTeacher
    ? items
    : items.filter((item) => hasSubject(mySubjects, item.subject))

  // Сданными считаем ДЗ, которые учитель отметил «Сдано».
  // Ученику сервер присылает только его собственный ответ.
  const acceptedCount = visibleItems.filter(
    (item) => item.student_homeworks?.[0]?.status === 'accepted'
  ).length

  // Сортируем по ID в обратном порядке (последние добавленные первыми)
  const sortedItems = [...visibleItems].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))

  const emptyMessage = isTeacher
    ? 'Заданий пока нет'
    : mySubjects.length === 0
      ? 'Учитель пока не назначил вам предметы'
      : 'Заданий по вашим предметам пока нет'

  // Задание и ответ для открытого чата берём из актуального списка —
  // так новые сообщения и отметки сразу видны в окне. Если ответ удалён, чата нет.
  const chatAssignment = openChat ? items.find((a) => a.id === openChat.assignmentId) : undefined
  const chatAnswer = chatAssignment?.student_homeworks?.find((sh) => sh.id === openChat?.answerId)
  const chat = chatAssignment && chatAnswer ? { assignment: chatAssignment, answer: chatAnswer } : null

  const assignmentsSection = (
    <section className={styles.assignmentsColumn}>
      {!isTeacher && <h2 className={styles.heading}>Задания</h2>}

      {sortedItems.length === 0 ? (
        <p>{emptyMessage}</p>
      ) : (
        <div className={styles.grid}>
          {sortedItems.map((item) => (
            <AssignmentCard key={item.id} assignment={item} user={user} onDelete={onDelete} />
          ))}
        </div>
      )}
    </section>
  )

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Добро пожаловать, {user.name}</h1>
        <div className={styles.headerRight}>
          <Link to="/tasks-bank" className={`${styles.typing} ${styles.withIcon}`}>
            <BookIcon />
            База заданий
          </Link>
          <Link to="/typing" className={styles.typing}>
            ⌨ Тренажёр печати
          </Link>
          {!isTeacher && <ProgressDonut done={acceptedCount} total={visibleItems.length} />}
          <button type="button" className={styles.logout} onClick={onLogout}>
            Выйти
          </button>
        </div>
      </div>

      {isTeacher ? (
        // Учитель: форма | ответы и ученики | все задания — в три колонки
        <div className={styles.tools}>
          <AssignmentForm onAdd={onAdd} />
          <div className={styles.sideColumn}>
            <AnswersPanel
              ref={answersRef}
              items={items}
              accounts={accounts}
              onReview={onReview}
              activeAnswerId={chat?.answer.id}
              onOpenChat={(assignmentId, answerId) => setOpenChat({ assignmentId, answerId })}
            />
            <BankTaskForm />
            <PaymentsPanel accounts={accounts} />
            <StudentsPanel
              accounts={accounts}
              availableSubjects={subjectsOf(items)}
              onAddStudent={onAddStudent}
              onDeleteStudent={onDeleteStudent}
              onSetSubjects={onSetSubjects}
            />
          </div>
          {chat ? (
            <div className={styles.assignmentsColumn}>
              <ChatWindow
                key={chat.answer.id}
                assignment={chat.assignment}
                answer={chat.answer}
                currentUserId={user.id}
                commentActions={commentActions}
                height={answersHeight}
                onClose={closeChat}
              />
            </div>
          ) : (
            assignmentsSection
          )}
        </div>
      ) : (
        assignmentsSection
      )}
    </div>
  )
}

// Иконка базы заданий: раскрытая книга в цветах платформы (белые страницы, тёмный контур)
function BookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#140f0f" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
        <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5z" fill="#fff" />
        <path d="M12 6.5C14 5 17 4.5 20.5 5v13c-3.5-.5-6.5 0-8.5 1.5z" fill="#fff" />
        <path d="M14.5 9.5h3.5M14.5 12.5h3.5" fill="none" />
      </g>
    </svg>
  )
}

export default HomePage
