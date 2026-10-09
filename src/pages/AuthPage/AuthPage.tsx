import styles from "./AuthButton.module.css";
import LoginForm from '../../components/LoginForm/LoginForm'
import AuthButton from '../../components/AuthButton/AuthButton'

function AuthPage() {
  return (
    <div className={styles.page}>
      <LoginForm />
      <AuthButton />
    </div>
  )
}

export default AuthPage