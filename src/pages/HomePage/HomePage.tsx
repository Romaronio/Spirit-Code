import { Navigate, useLocation } from 'react-router-dom'
import styles from './HomePage.module.css'
import type { Account, Assignment, User } from '../../types'
import AssignmentCard from '../../components/AssignmentCard/AssignmentCard'
import AssignmentForm from '../../components/AssignmentForm/AssignmentForm'
import StudentsPanel from '../../components/StudentsPanel/StudentsPanel'

interface Props {
  items: Assignment[]
  onAdd: (assignment: Assignment) => void
  accounts: Account[]
  onAddStudent: (student: Account) => void
  onDeleteStudent: (name: string) => void
}


function HomePage({ items, onAdd, accounts, onAddStudent }: Props) {
  const location = useLocation()
  const user = location.state as User | null

  if (!user) {
    return <Navigate to="/" replace />
  }

  const roleLabel = user.role === 'teacher' ? 'Учитель' : 'Ученик'

  return (
    <div className={styles.page}>
      <h1>Добро пожаловать, {user.name}</h1>
      <p>Ваша роль: {roleLabel}</p>

      {user.role === 'teacher' && (
        <>
          <AssignmentForm onAdd={onAdd} />
           <StudentsPanel
            accounts={accounts}
            onAddStudent={onAddStudent}
            onDeleteStudent={onDeleteStudent}
          />
        </>
      )}

      <h2 className={styles.heading}>Задания</h2>

      {items.length === 0 ? (
        <p>Заданий пока нет</p>
      ) : (
        <div className={styles.grid}>
          {items.map((item) => (
            <AssignmentCard key={item.id} assignment={item} user={user} />
          ))}
        </div>
      )}
    </div>
  )
}

export default HomePage