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
  async function handleUpdate(id: Assignment['id'], changes: AssignmentChanges)
  {
    try {
      if (!id) return

      // Если обновляется homework, обрабатываем отдельно
      if (changes.homework) {
        const homeworkData = changes.homework
        const assignment = items.find((item) => item.id === id)

        if (assignment?.homework?.id) {
          // Обновляем существующее homework
          await api.updateHomework(assignment.homework.id, {
            description: homeworkData.description
          })
        } else {
          // Создаем новое homework
          await api.createHomework({
            assignment: id,
            description: homeworkData.description
          })
        }

        // Удаляем homework из changes, чтобы не отправлять в Assignment
        const { homework, ...assignmentChanges } = changes

        // Если есть изменения в description/recording_url/files — обновляем Assignment
        if (
          Object.keys(assignmentChanges).length > 0 ||
          homeworkData.files?.length
        ) {
          const updated = await api.updateAssignment(id, {
            ...assignmentChanges,
            homework_files: homeworkData.files,
          })
          setItems((prev) =>
            prev.map((item) => (item.id === id ? updated : item))
          )
        }

        // Перезагружаем задание с обновленным homework
        const refreshed = await api.getAssignment(id)
        setItems((prev) =>
          prev.map((item) => (item.id === id ? refreshed : item))
        )
      } else {
        // Обычное обновление Assignment (с возможными файлами)
        const updated = await api.updateAssignment(id, changes)
        setItems((prev) =>
          prev.map((item) => (item.id === id ? updated : item))
        )
      }
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