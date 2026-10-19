import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import AuthPage from './pages/AuthPage/AuthPage'
import HomePage from './pages/HomePage/HomePage'
import AssignmentPage from './pages/AssignmentPage/AssignmentPage'
import type { Account, Assignment, AssignmentChanges } from './types'
import * as api from './services/api'


function App() {
  const [items, setItems] = useState<Assignment[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  // Загрузка данных при монтировании
  useEffect(() => {
    async function loadData() {
      try {
        const [accountsData, assignmentsData] = await Promise.all([
          api.getAllAccounts(),
          api.getAllAssignments(),
        ])
        setAccounts(accountsData)
        setItems(assignmentsData)
      } catch (error) {
        console.error('Ошибка загрузки данных:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  async function handleAdd(data: {
    title: string
    subject: string
    deadline: string
    description?: string
    recording_url?: string
    homework?: { description: string }
    files?: File[]
    homework_files?: File[]
  }) {
    try {
      const newAssignment = await api.createAssignment(data)
      setItems((prev) => [newAssignment, ...prev])
    } catch (error) {
      console.error('Ошибка создания задания:', error)
      throw error
    }
  }

  async function handleUpdate(id: Assignment['id'], changes: AssignmentChanges) {
    if (!id) return

    try {
      // Описание ДЗ и его файлы уходят одним PATCH-запросом вместе с остальными
      // изменениями: сервер сам создаст или обновит ДЗ и прикрепит файлы.
      const { homework, ...assignmentChanges } = changes
      const updated = await api.updateAssignment(id, {
        ...assignmentChanges,
        homework: homework ? { description: homework.description } : undefined,
        homework_files: homework?.files,
      })
      setItems((prev) =>
        prev.map((item) => (item.id === id ? updated : item))
      )
    } catch (error) {
      console.error('Ошибка обновления задания:', error)
      throw error
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteAssignment(id)
      setItems((prev) => prev.filter((item) => item.id !== id))
    } catch (error) {
      console.error('Ошибка удаления задания:', error)
      throw error
    }
  }

  async function handleAddStudent(student: Omit<Account, 'id'>) {
    try {
      const newStudent = await api.createAccount(student)
      setAccounts((prev) => [...prev, newStudent])
    } catch (error) {
      console.error('Ошибка добавления ученика:', error)
      throw error
    }
  }

  async function handleDeleteStudent(id: number) {
    try {
      await api.deleteAccount(id)
      setAccounts((prev) => prev.filter((a) => a.id !== id))
    } catch (error) {
      console.error('Ошибка удаления ученика:', error)
      throw error
    }
  }

  async function handleSetSubjects(id: number, subjects: string[]) {
    try {
      const account = accounts.find((a) => a.id === id)
      if (!account) return

      const updated = await api.updateAccount(id, { ...account, subjects })
      setAccounts((prev) =>
        prev.map((a) => (a.id === id ? updated : a))
      )
    } catch (error) {
      console.error('Ошибка обновления предметов:', error)
      throw error
    }
  }

  async function refreshStudentHomeworks(assignmentId: number) {
    try {
      const refreshed = await api.getAssignment(assignmentId)
      setItems((prev) =>
        prev.map((item) => (item.id === assignmentId ? refreshed : item))
      )
    } catch (error) {
      console.error('Ошибка обновления ответов учеников:', error)
    }
  }

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Загрузка...</div>
  }

  return (
    <Routes>
      <Route path="/" element={<AuthPage />} />
      <Route
        path="/home"
        element={
          <HomePage
            items={items}
            onAdd={handleAdd}
            onDelete={handleDelete}
            accounts={accounts}
            onAddStudent={handleAddStudent}
            onDeleteStudent={handleDeleteStudent}
            onSetSubjects={handleSetSubjects}
          />
        }
      />
      <Route
        path="/assignment/:id"
        element={
          <AssignmentPage
            items={items}
            accounts={accounts}
            onUpdate={handleUpdate}
            onSubmitStudentHomework={refreshStudentHomeworks}
          />
        }
      />
    </Routes>
  )
}

export default App
