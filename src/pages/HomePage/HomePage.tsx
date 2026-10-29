import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, Navigate } from 'react-router-dom'
import styles from './HomePage.module.css'
import type { Account, Assignment, CommentActions, NewAssignment, ReviewStatus, User } from '../../types'
import AssignmentCard from '../../components/AssignmentCard/AssignmentCard'
import CallsBar from '../../components/CallsBar/CallsBar'
import AssignmentForm from '../../components/AssignmentForm/AssignmentForm'
import StudentsPanel from '../../components/StudentsPanel/StudentsPanel'
import AnswersPanel from '../../components/AnswersPanel/AnswersPanel'
import ProgressDonut from '../../components/ProgressDonut/ProgressDonut'
import PaymentsPanel from '../../components/PaymentsPanel/PaymentsPanel'
import BankTaskForm from '../../components/BankTaskForm/BankTaskForm'
import ChatWindow from '../../components/ChatWindow/ChatWindow'
import { hasSubject, normalize, subjectsOf, uniqueSubjects } from '../../utils/subjects'

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

  // Сколько уроков в одной строке на ПК. Выбор запоминаем в браузере
  const [perRow, setPerRow] = useState(readPerRow)
  const changePerRow = (value: number) => {
    setPerRow(value)
    try {
      localStorage.setItem(PER_ROW_KEY, String(value))
    } catch {
      // без localStorage просто не запоминаем
    }
  }
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

  // Ученику — сколько заданий ещё ждут решения (не отправлены или «Не сдано»),
  // учителю — сколько ответов ждут проверки
  const rejectedCount = visibleItems.filter(
    (item) => item.student_homeworks?.[0]?.status === 'rejected'
  ).length
  const todoCount =
    visibleItems.filter((item) => !item.student_homeworks?.[0]).length + rejectedCount
  const pendingReviewCount = items
    .flatMap((item) => item.student_homeworks ?? [])
    .filter((answer) => (answer.status ?? 'pending') === 'pending').length

  const lead = isTeacher
    ? pendingReviewCount > 0
      ? `${plural(pendingReviewCount, 'ответ ждёт', 'ответа ждут', 'ответов ждут')} проверки.`
      : 'Все ответы учеников проверены.'
    : todoCount > 0
      ? `${plural(todoCount, 'задание ждёт', 'задания ждут', 'заданий ждут')} решения.`
      : 'Все задания отправлены — так держать.'

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
      {/* Заголовок слева, справа — выбор числа уроков в строке (только на ПК) */}
      <div className={`${styles.headingRow} ${isTeacher ? styles.headingRowTeacher : ''}`}>
        {!isTeacher && <h2 className={styles.heading}>Задания</h2>}
        {sortedItems.length > 0 && (
          <div className={styles.perRow} role="group" aria-label="Уроков в строке">
            <span className={styles.perRowLabel}>Уроков в строке:</span>
            {PER_ROW_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.perRowButton} ${perRow === value ? styles.perRowActive : ''}`}
                aria-pressed={perRow === value}
                onClick={() => changePerRow(value)}
              >
                {value}
              </button>
            ))}
          </div>
        )}
      </div>

      {sortedItems.length === 0 ? (
        <p>{emptyMessage}</p>
      ) : (
        <div
          className={`${styles.grid} ${styles.gridFixed}`}
          style={{ '--per-row': perRow } as CSSProperties}
          data-per-row={perRow}
        >
          {sortedItems.map((item) => (
            <AssignmentCard key={item.id} assignment={item} user={user} onDelete={onDelete} />
          ))}
        </div>
      )}
    </section>
  )

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link to="/home" className={styles.logo}>
            <span className={styles.logoMark} aria-hidden="true">&gt;_</span>
            Spirit Code
          </Link>
          <nav className={styles.nav} aria-label="Основная навигация">
            <Link to="/home" className={`${styles.navLink} ${styles.navActive}`} aria-current="page">
              Задания
            </Link>
            <Link to="/tasks-bank" className={`${styles.navLink} ${styles.navAccent}`}>
              <BookIcon />
              База заданий
            </Link>
            <Link to="/typing" className={`${styles.navLink} ${styles.navAccent}`}>
              Тренажёр печати
            </Link>
          </nav>
          <button type="button" className={styles.logout} onClick={onLogout}>
            Выйти
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.welcome}>
            {isTeacher && <span className={styles.prompt}>~/spirit-code $ whoami</span>}
            <h1 className={styles.greeting}>Добро пожаловать, {user.name}</h1>
            <p className={styles.lead}>{lead}</p>
          </div>
          {!isTeacher && (
            <div className={styles.progressCard}>
              <ProgressDonut done={acceptedCount} total={visibleItems.length} />
              <div className={styles.progressText}>
                <span className={styles.progressLabel}>Прогресс</span>
                <span className={styles.progressValue}>
                  {plural(acceptedCount, 'задание принято', 'задания принято', 'заданий принято')}
                </span>
                <span className={styles.progressNote}>
                  {rejectedCount > 0 ? `${rejectedCount} на доработке` : `всего ${visibleItems.length}`}
                </span>
              </div>
            </div>
          )}
        </section>

        <CallsBar
          isTeacher={isTeacher}
          subjects={uniqueSubjects([...accounts.flatMap((a) => a.subjects ?? []), ...items.map((a) => a.subject)])}
          students={accounts.filter((a) => a.role === 'student' && a.id != null)}
        />

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
      </main>
    </div>
  )
}

// 1 задание, 2 задания, 5 заданий
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  const word =
    mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many
  return `${n} ${word}`
}

// Иконка базы заданий: раскрытая книга, контур цвета текста ссылки
const PER_ROW_KEY = 'spirit.lessonsPerRow'
const PER_ROW_OPTIONS = [1, 3, 5, 7]
const PER_ROW_DEFAULT = 3

function readPerRow(): number {
  try {
    const value = Number(localStorage.getItem(PER_ROW_KEY))
    return PER_ROW_OPTIONS.includes(value) ? value : PER_ROW_DEFAULT
  } catch {
    return PER_ROW_DEFAULT
  }
}

function BookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" fill="none">
        <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5z" />
        <path d="M12 6.5C14 5 17 4.5 20.5 5v13c-3.5-.5-6.5 0-8.5 1.5z" />
        <path d="M14.5 9.5h3.5M14.5 12.5h3.5" />
      </g>
    </svg>
  )
}

export default HomePage
