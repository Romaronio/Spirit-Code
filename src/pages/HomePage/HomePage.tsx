import { Navigate, useLocation } from 'react-router-dom'
import styles from './HomePage.module.css'
import type { Account, Assignment, User } from '../../types'
import AssignmentCard from '../../components/AssignmentCard/AssignmentCard'
import AssignmentForm from '../../components/AssignmentForm/AssignmentForm'
import StudentsPanel from '../../components/StudentsPanel/StudentsPanel'
import { hasSubject, normalize, subjectsOf } from '../../utils/subjects'
import { loadUser } from '../../utils/session'

interface Props {
  items: Assignment[]
  onAdd: (assignment: Omit<Assignment, 'id'>) => void
  onDelete: (id: number) => void
  accounts: Account[]
  onAddStudent: (student: Omit<Account, 'id'>) => void
  onDeleteStudent: (id: number) => void
  onSetSubjects: (id: number, subjects: string[]) => void
}

function HomePage({
  items,
  onAdd,
  onDelete,
  accounts,
  onAddStudent,
  onDeleteStudent,
  onSetSubjects,
}: Props) {
  const location = useLocation()
  const user = (location.state as User | null) ?? loadUser()

  if (!user) {
    return <Navigate to="/" replace />
  }

  const isTeacher = user.role === 'teacher'
  const roleLabel = isTeacher ? 'Учитель' : 'Ученик'

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

  return (
    <div className={styles.page}>
      <h1>Добро пожаловать, {user.name}</h1>
      <p>Ваша роль: {roleLabel}</p>
      {!isTeacher && mySubjects.length > 0 && (
        <p>Ваши предметы: {mySubjects.join(', ')}</p>
      )}

      {isTeacher && (
        <div className={styles.tools}>
          <AssignmentForm onAdd={onAdd} />
          <StudentsPanel
            accounts={accounts}
            availableSubjects={subjectsOf(items)}
            onAddStudent={onAddStudent}
            onDeleteStudent={onDeleteStudent}
            onSetSubjects={onSetSubjects}
          />
        </div>
      )}

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
    </div>
  )
}

export default HomePage