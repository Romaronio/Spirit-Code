import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import AuthPage from './pages/AuthPage/AuthPage'
import HomePage from './pages/HomePage/HomePage'
import AssignmentPage from './pages/AssignmentPage/AssignmentPage'
import type { Account, Assignment } from './types'
import { assignments as initialAssignments } from './data/assignments'
import { accounts as initialAccounts } from './data/users'

const ACCOUNTS_KEY = 'spirit-code-accounts'

function loadAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    return raw ? (JSON.parse(raw) as Account[]) : initialAccounts
  } catch {
    return initialAccounts
  }
}

function saveAccounts(accounts: Account[]) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
  } catch {
    // хранилище недоступно: аккаунты просто не сохранятся между перезагрузками
  }
}

function App() {
  const [items, setItems] = useState<Assignment[]>(initialAssignments)
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts)

  function handleAdd(assignment: Assignment) {
    setItems((prev) => [assignment, ...prev])
  }

  function handleUpdate(id: Assignment['id'], changes: Partial<Assignment>) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item))
    )
  }

  function handleAddStudent(student: Account) {
    const next = [...accounts, student]
    setAccounts(next)
    saveAccounts(next)
  }

  function handleDeleteStudent(name: string) {
    const next = accounts.filter((a) => !(a.role === 'student' && a.name === name))
    setAccounts(next)
    saveAccounts(next)
  }

  return (
    <Routes>
      <Route path="/" element={<AuthPage accounts={accounts} />} />
      <Route
        path="/home"
        element={
          <HomePage
            items={items}
            onAdd={handleAdd}
            accounts={accounts}
            onAddStudent={handleAddStudent}
            onDeleteStudent={handleDeleteStudent}
          />
        }
      />
      <Route
        path="/assignment/:id"
        element={<AssignmentPage items={items} onUpdate={handleUpdate} />}
      />
    </Routes>
  )
}

export default App