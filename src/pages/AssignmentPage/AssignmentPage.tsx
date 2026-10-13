import { useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import styles from './AssignmentPage.module.css'
import type { Account, Assignment, LessonFile, User } from '../../types'
import { hasSubject, normalize } from '../../utils/subjects'

interface PageProps {
  items: Assignment[]
  accounts: Account[]
  onUpdate: (id: Assignment['id'], changes: Partial<Assignment>) => void
}

function AssignmentPage({ items, accounts, onUpdate }: PageProps) {
  const { id } = useParams()
  const location = useLocation()
  const user = location.state as User | null

  if (!user) {
    return <Navigate to="/" replace />
  }

  const found = items.find((item) => item.id === id)

  // Ученик видит только задания по своим предметам
  const account = accounts.find((a) => normalize(a.name) === normalize(user.name))
  const allowed =
    found !== undefined &&
    (user.role === 'teacher' || hasSubject(account?.subjects, found.subject))
  const assignment = allowed ? found : undefined

  if (!assignment) {
    return (
      <div className={styles.page}>
        <Link to="/home" state={user} className={styles.back}>← Ко всем заданиям</Link>
        <p>Задание не найдено</p>
      </div>
    )
  }

  return <AssignmentDetails assignment={assignment} user={user} onUpdate={onUpdate} />
}