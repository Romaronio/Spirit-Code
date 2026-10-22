import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import AuthPage from './pages/AuthPage/AuthPage'
import HomePage from './pages/HomePage/HomePage'
import AssignmentPage from './pages/AssignmentPage/AssignmentPage'
import type { Account, Assignment, AssignmentChanges, ReviewStatus, User } from './types'
import * as api from './services/api'
import { clearSession, loadUser } from './utils/session'


function App() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(() => loadUser())
  const [items, setItems] = useState<Assignment[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(() => loadUser() !== null)

  // Загрузка данных после входа. Список учеников доступен только учителю,
  // ученик получает лишь свой аккаунт (с актуальными предметами).
  useEffect(() => {
    if (!user) return
    let cancelled = false

    async function loadData(role: User['role']) {
      try {
        const [accountsData, assignmentsData] = await Promise.all([
          role === 'teacher' ? api.getAllAccounts() : api.getMe().then((me) => [me]),
          api.getAllAssignments(),
        ])
        if (cancelled) return
        setAccounts(accountsData)
        setItems(assignmentsData)
      } catch (error) {
        console.error('Ошибка загрузки данных:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadData(user.role)

    return () => {
      cancelled = true
    }
  }, [user])

  function handleLogin(loggedIn: User) {
    setLoading(true)
    setUser(loggedIn)
  }

  async function handleLogout() {
    try {
      await api.logout()
    } catch {
      /* токен мог уже истечь — всё равно выходим */
    }
    clearSession()
    setUser(null)
    setItems([])
    setAccounts([])
    navigate('/', { replace: true })
  }

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

  // Отметка учителя по ответу ученика: меняем только этот ответ в списке
  async function handleReview(assignmentId: number, answerId: number, status: ReviewStatus) {
    const updated = await api.reviewStudentHomework(answerId, status)
    setItems((prev) =>
      prev.map((item) =>
        item.id !== assignmentId
          ? item
          : {
              ...item,
              student_homeworks: item.student_homeworks?.map((sh) => (sh.id === answerId ? updated : sh)),
            }
      )
    )
  }

  // Перечитывает все задания: новые ответы учеников и свежие ссылки на файлы
  const refreshAssignments = useCallback(async () => {
    try {
      setItems(await api.getAllAssignments())
    } catch (error) {
      console.error('Ошибка обновления заданий:', error)
    }
  }, [])

  // Перечитывает задание с сервера: свежие ответы учеников и новые
  // подписанные ссылки на файлы (старые со временем перестают работать)
  const refreshAssignment = useCallback(async (assignmentId: number) => {
    try {
      const refreshed = await api.getAssignment(assignmentId)
      setItems((prev) =>
        prev.map((item) => (item.id === assignmentId ? refreshed : item))
      )
    } catch (error) {
      console.error('Ошибка обновления задания:', error)
    }
  }, [])

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Загрузка...</div>
  }

  return (
    <Routes>
      <Route path="/" element={<AuthPage onLogin={handleLogin} />} />
      <Route
        path="/home"
        element={
          <HomePage
            user={user}
            onLogout={handleLogout}
            items={items}
            onAdd={handleAdd}
            onDelete={handleDelete}
            accounts={accounts}
            onAddStudent={handleAddStudent}
            onDeleteStudent={handleDeleteStudent}
            onSetSubjects={handleSetSubjects}
            onRefresh={refreshAssignments}
            onReview={handleReview}
          />
        }
      />
      <Route
        path="/assignment/:id"
        element={
          <AssignmentPage
            user={user}
            items={items}
            accounts={accounts}
            onUpdate={handleUpdate}
            onOpen={refreshAssignment}
            onReview={handleReview}
            onSubmitStudentHomework={refreshAssignment}
          />
        }
      />
    </Routes>
  )
}

export default App
