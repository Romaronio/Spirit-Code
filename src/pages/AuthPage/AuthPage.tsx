import styles from './AuthPage.module.css'
import LoginForm from '../../components/LoginForm/LoginForm'
import type { User } from '../../types'

interface Props {
  onLogin: (user: User) => void
}

function AuthPage({ onLogin }: Props) {
  return (
    <div className={styles.page}>
      <LoginForm onLogin={onLogin} />
    </div>
  )
}

export default AuthPage