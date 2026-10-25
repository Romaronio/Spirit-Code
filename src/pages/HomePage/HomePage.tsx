import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import styles from './HomePage.module.css'
import type { Account, Assignment, CommentActions, ReviewStatus, User } from '../../types'
import AssignmentCard from '../../components/AssignmentCard/AssignmentCard'
import AssignmentForm from '../../components/AssignmentForm/AssignmentForm'
import StudentsPanel from '../../components/StudentsPanel/StudentsPanel'
import AnswersPanel from '../../components/AnswersPanel/AnswersPanel'
import ProgressDonut from '../../components/ProgressDonut/ProgressDonut'
import PaymentsPanel from '../../components/PaymentsPanel/PaymentsPanel'
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
  onRefresh: () => Promise<void>;
  onReview: (assignmentId: number, answerId: number, status: ReviewStatus) => Promise<void>;
  commentActions: CommentActions;
  onAdd: (data: {
    title: string
    subject: string
    deadline: string
    description?: string
    recording_url?: string
    homework?: { description: string }
    files?: File[]
    homework_files?: File[]
  }) => Promise<void>;
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
  onRefresh,
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
      <h2 className={styles.heading}>Задания</h2>

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
          {!isTeacher && <ProgressDonut done={acceptedCount} total={visibleItems.length} />}
          <Link to="/typing" className={styles.typing}>
            ⌨ Тренажёр печати
          </Link>
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
              onRefresh={onRefresh}
              onReview={onReview}
              activeAnswerId={chat?.answer.id}
              onOpenChat={(assignmentId, answerId) => setOpenChat({ assignmentId, answerId })}
            />
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

export default HomePage
