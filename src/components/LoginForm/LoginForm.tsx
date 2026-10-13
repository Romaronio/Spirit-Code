import styles from './LoginForm.module.css'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Account, User } from '../../types'

interface Props {
  accounts: Account[]
}

function LoginForm({ accounts }: Props) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmedName = name.trim()

    if (trimmedName === '' || password === '') {
      setError('Введите имя и пароль')
      return
    }

    const account = accounts.find(
      (a) =>
        a.name.toLowerCase() === trimmedName.toLowerCase() &&
        a.password === password
    )

    if (!account) {
      setError('Неверное имя или пароль')
      return
    }

    // Пароль дальше не передаём: только имя и роль
    const user: User = { name: account.name, role: account.role }
    navigate('/home', { state: user })
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

      <button type="submit" className={styles.submit}>
        Войти
      </button>
    </form>
  )
}

export default LoginForm