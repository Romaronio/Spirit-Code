import { Navigate } from 'react-router-dom'
import styles from './HomePage.module.css'
import type { Account, Assignment, User } from '../../types'
import AssignmentCard from '../../components/AssignmentCard/AssignmentCard'
import AssignmentForm from '../../components/AssignmentForm/AssignmentForm'
import StudentsPanel from '../../components/StudentsPanel/StudentsPanel'
import AnswersPanel from '../../components/AnswersPanel/AnswersPanel'
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
}: Props) {
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

  // Сортируем по ID в обратном порядке (последние добавленные первыми)
  const sortedItems = [...visibleItems].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))

  const emptyMessage = isTeacher
    ? 'Заданий пока нет'
    : mySubjects.length === 0
      ? 'Учитель пока не назначил вам предметы'
      : 'Заданий по вашим предметам пока нет'

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
        <button type="button" className={styles.logout} onClick={onLogout}>
          Выйти
        </button>
      </div>

      {isTeacher ? (
        // Учитель: форма | ответы и ученики | все задания — в три колонки
        <div className={styles.tools}>
          <AssignmentForm onAdd={onAdd} />
          <div className={styles.sideColumn}>
            <AnswersPanel items={items} accounts={accounts} onRefresh={onRefresh} />
            <StudentsPanel
              accounts={accounts}
              availableSubjects={subjectsOf(items)}
              onAddStudent={onAddStudent}
              onDeleteStudent={onDeleteStudent}
              onSetSubjects={onSetSubjects}
            />
          </div>
          {assignmentsSection}
        </div>
      ) : (
        assignmentsSection
      )}
    </div>
  )
}

export default HomePage
