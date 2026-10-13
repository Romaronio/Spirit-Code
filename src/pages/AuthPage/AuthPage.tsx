import styles from './AuthPage.module.css'
import LoginForm from '../../components/LoginForm/LoginForm'

function AuthPage() {
  return (
    <div className={styles.page}>
      <LoginForm />
    </div>
  )
}

export default AuthPage