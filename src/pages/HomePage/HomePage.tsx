import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import styles from './HomePage.module.css'
import type { Assignment, User } from '../../types'
import { assignments as initialAssignments } from '../../data/assignments'
import AssignmentCard from '../../components/AssignmentCard/AssignmentCard'
import AssignmentForm from '../../components/AssignmentForm/AssignmentForm'

function HomePage() {
  const location = useLocation()
  console.log(location)
  const user = location.state as User | null
  const [items, setItems] = useState<Assignment[]>(initialAssignments)

  if (!user) {
    return <Navigate to="/" replace />
  }

  function handleAdd(assignment: Assignment) {
    setItems((prev) => [assignment, ...prev])
  }

  function handleUpdate(id: Assignment['id'], changes: Partial<Assignment>) {
  setItems((prev) =>
    prev.map((item) => (item.id === id ? { ...item, ...changes } : item))
    )
  }

  const roleLabel = user.role === 'teacher' ? 'Учитель' : 'Ученик'

  return (
    <div className={styles.page}>
      <h1>Добро пожаловать, {user.name}</h1>
      <p>Ваша роль: {roleLabel}</p>

      {user.role === 'teacher' && <AssignmentForm onAdd={handleAdd} />}

      <h2 className={styles.heading}>Задания</h2>

      {items.length === 0 ? (
        <p>Заданий пока нет</p>
      ) : (
        <div className={styles.grid}>
          {items.map((item) => (
            <AssignmentCard key={item.id} assignment={item} canEdit={user.role === 'teacher'} onUpdate={handleUpdate} />
          ))}
        </div>
      )}
    </div>
  )
}

export default HomePage