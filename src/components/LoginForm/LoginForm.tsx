import styles from './LoginForm.module.css'

function LoginForm() {
  return (
    <div className={styles.form}>
      <input type="text" placeholder="Логин" />
      <input type="password" placeholder="Пароль" />
    </div>
  )
}

export default LoginForm