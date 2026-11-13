import { lazy, Suspense, useState, useEffect, useCallback } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import AuthPage from './pages/AuthPage/AuthPage'
import HomePage from './pages/HomePage/HomePage'
import AssignmentPage from './pages/AssignmentPage/AssignmentPage'
import TypingPage from './pages/TypingPage/TypingPage'
import LessonsPage from './pages/LessonsPage/LessonsPage'
import StudentPage from './pages/StudentPage/StudentPage'
import type { Account, AnswerComment, Assignment, AssignmentChanges, CommentActions, NewAssignment, ReviewStatus, Subject, User } from './types'
import * as api from './services/api'
import { clearSession, loadUser } from './utils/session'
import { canReview } from './utils/roles'
import { disablePush } from './utils/push'

// Как часто спрашиваем сервер, не изменилось ли что-то (крошечный запрос — только номер версии)
const UPDATES_POLL_MS = 4000

// Страница созвона тянет LiveKit (сотни КБ) — грузим её, только когда открывают урок
const CallPage = lazy(() => import('./pages/CallPage/CallPage'))


function App() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(() => loadUser())
  const [items, setItems] = useState<Assignment[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([]) // только у учителя
  const [loading, setLoading] = useState(() => loadUser() !== null)

  // Загрузка данных после входа. Список учеников доступен только учителю,
  // ученик получает лишь свой аккаунт (с актуальными предметами).
  useEffect(() => {
    if (!user) return
    let cancelled = false

    async function loadData(role: User['role']) {
      try {
        const [accountsData, assignmentsData, subjectsData] = await Promise.all([
          canReview(role) ? api.getAllAccounts() : api.getMe().then((me) => [me]),
          api.getAllAssignments(),
          canReview(role) ? api.getSubjects() : Promise.resolve([]),
        ])
        if (cancelled) return
        setAccounts(accountsData)
        setItems(assignmentsData)
        setSubjects(subjectsData)
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

  // Новые уроки, ответы и сообщения приходят сами, без обновления страницы:
  // раз в несколько секунд сверяем номер версии данных и, если он сменился, перезагружаем
  useEffect(() => {
    if (!user) return
    let cancelled = false
    let busy = false
    let known: number | null = null

    async function check() {
      if (busy || document.hidden) return
      busy = true
      try {
        const version = await api.getUpdatesVersion()
        if (cancelled) return
        if (known !== null && version !== known) {
          const [accountsData, assignmentsData, subjectsData] = await Promise.all([
            canReview(user!.role) ? api.getAllAccounts() : api.getMe().then((me) => [me]),
            api.getAllAssignments(),
            canReview(user!.role) ? api.getSubjects() : Promise.resolve([]),
          ])
          if (cancelled) return
          setAccounts(accountsData)
          setItems(assignmentsData)
          setSubjects(subjectsData)
        }
        known = version
      } catch {
        // нет сети или сервер перезапускается — проверим в следующий раз
      } finally {
        busy = false
      }
    }

    void check()
    const timer = window.setInterval(check, UPDATES_POLL_MS)
    const onVisible = () => void check() // вернулись на вкладку — сразу проверяем
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [user])

  function handleLogin(loggedIn: User) {
    setLoading(true)
    setUser(loggedIn)
  }

  async function handleLogout() {
    await disablePush() // на этом устройстве уведомления этого аккаунта больше не нужны
    try {
      await api.logout()
    } catch {
      /* токен мог уже истечь — всё равно выходим */
    }
    clearSession()
    setUser(null)
    setItems([])
    setAccounts([])
    setSubjects([])
    navigate('/', { replace: true })
  }

  async function handleAdd(data: NewAssignment) {
    try {
      const newAssignment = await api.createAssignment(data)
      setItems((prev) => [newAssignment, ...prev])
      // Урок по новому предмету добавил его в список предметов на сервере
      api.getSubjects().then(setSubjects).catch(() => {})
    } catch (error) {
      console.error('Ошибка создания задания:', error)
      throw error
    }
  }

  // Порядок уроков в папке-теме (База уроков): сразу показываем, потом сохраняем
  async function handleReorder(topic: string, ids: number[]) {
    const place = new Map(ids.map((id, i) => [id, i + 1]))
    const before = items
    setItems((prev) => prev.map((a) => (a.id && place.has(a.id) ? { ...a, topic, position: place.get(a.id) } : a)))
    try {
      await api.reorderLessons(topic, ids)
    } catch (err) {
      setItems(before)
      throw err
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
        homework: homework && {
          numbered_tasks: homework.numbered_tasks,
          tasks_latex: homework.tasks_latex,
          task_files: homework.task_files,
          delete_file_ids: homework.delete_file_ids,
        },
        homework_files: homework?.files,
      })
      setItems((prev) =>
        prev.map((item) => (item.id === id ? updated : item))
      )
      // Урок перенесли в предмет, которого не было в списке, — сервер его добавил
      if (changes.subject !== undefined) api.getSubjects().then(setSubjects).catch(() => {})
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

  async function handleAddSubject(name: string) {
    const subject = await api.createSubject(name)
    setSubjects((prev) =>
      prev.some((s) => s.id === subject.id) ? prev : [...prev, subject].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    )
  }

  async function handleDeleteSubject(id: number) {
    await api.deleteSubject(id)
    setSubjects((prev) => prev.filter((s) => s.id !== id))
  }

  // Ученики, закреплённые за куратором (меняет только создатель)
  async function handleSetCuratorStudents(id: number, students: number[]) {
    const updated = await api.updateAccount(id, { students })
    setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)))
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

  // Меняет переписку одного ответа в списке заданий
  function updateComments(
    assignmentId: number,
    answerId: number,
    change: (comments: AnswerComment[]) => AnswerComment[]
  ) {
    setItems((prev) =>
      prev.map((item) =>
        item.id !== assignmentId
          ? item
          : {
              ...item,
              student_homeworks: item.student_homeworks?.map((sh) =>
                sh.id === answerId ? { ...sh, comments: change(sh.comments ?? []) } : sh
              ),
            }
      )
    )
  }

  const commentActions: CommentActions = {
    async add(assignmentId, answerId, text) {
      const comment = await api.addComment(answerId, text)
      updateComments(assignmentId, answerId, (list) => [...list, comment])
    },
    async edit(assignmentId, answerId, commentId, text) {
      const updated = await api.editComment(commentId, text)
      updateComments(assignmentId, answerId, (list) => list.map((c) => (c.id === commentId ? updated : c)))
    },
    async remove(assignmentId, answerId, commentId) {
      await api.deleteComment(commentId)
      updateComments(assignmentId, answerId, (list) => list.filter((c) => c.id !== commentId))
    },
  }

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
            onSetCuratorStudents={handleSetCuratorStudents}
            onReview={handleReview}
            commentActions={commentActions}
            subjects={subjects}
            onDeleteSubject={handleDeleteSubject}
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
            commentActions={commentActions}
            onSubmitStudentHomework={refreshAssignment}
          />
        }
      />
      <Route path="/typing" element={<TypingPage user={user} onLogout={handleLogout} />} />
      <Route path="/student/:id" element={<StudentPage user={user} items={items} accounts={accounts} />} />
      <Route
        path="/lessons"
        element={
          <LessonsPage
            user={user}
            items={items}
            subjects={subjects}
            onUpdate={handleUpdate}
            onAddSubject={handleAddSubject}
            onReorder={handleReorder}
          />
        }
      />
      <Route
        path="/call/:id"
        element={
          <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Загрузка...</div>}>
            <CallPage user={user} />
          </Suspense>
        }
      />
    </Routes>
  )
}

export default App
