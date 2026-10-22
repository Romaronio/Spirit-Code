import styles from './LoginForm.module.css'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '../../types'
import { saveSession } from '../../utils/session'
import * as api from '../../services/api'

interface Props {
  onLogin: (user: User) => void
}

function LoginForm({ onLogin }: Props) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmedName = name.trim()

    if (trimmedName === '' || password === '') {
      setError('Введите имя и пароль')
      return
    }

    setLoading(true)
    setError('')

    try {
      const { token, account } = await api.login(trimmedName, password)
      const user: User = { id: account.id, name: account.name, role: account.role }
      saveSession(token, user)
      onLogin(user)
      navigate('/home')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неверное имя или пароль')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h1 className={styles.title}>Spirit Code</h1>
      <input
        type="text"
        placeholder="Ваше имя"
        autoComplete="username"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setError('')
        }}
      />
      <input
        type="password"
        placeholder="Пароль"
        autoComplete="current-password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value)
          setError('')
        }}
      />
      {error && <p className={styles.error}>{error}</p>}

      <button type="submit" className={styles.submit} disabled={loading}>
        {loading ? 'Вход...' : 'Войти'}
      </button>
    </form>
  )
}

export default LoginForm