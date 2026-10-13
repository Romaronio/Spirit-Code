import styles from './AuthPage.module.css'
import LoginForm from '../../components/LoginForm/LoginForm'
import type { Account } from '../../types'

interface Props {
  accounts: Account[]
}

function AuthPage({ accounts }: Props) {
  return (
    <div className={styles.page}>
      <LoginForm accounts={accounts} />
    </div>
  )
}

export default AuthPage