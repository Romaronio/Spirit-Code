import { useNavigate } from 'react-router-dom'
import styles from './AuthButtons.module.css'

function AuthButton() {
  const navigate = useNavigate()

  return (
    <div className={styles.buttons}>
      <button onClick={() => navigate('/home')}>Войти</button>
      <button onClick={() => navigate('/home')}>Зарегистрироваться</button>
    </div>
  )
}

export default AuthButton