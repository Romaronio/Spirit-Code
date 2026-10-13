import styles from './LoginForm.module.css'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Role } from '../../types'


function LoginForm() {
    const [name, setName] = useState('')
    const[role, setRole] = useState<Role>('student')
    const [error, setError] = useState('')
    const navigate = useNavigate()

    function handelSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const trimmedName = name.trim()
        if (trimmedName == '') {
            setError('Введите коректное имя')
            return
        }
        navigate('/home', { state: { name: trimmedName, role } })
    }


    return (
        <form className={styles.form} onSubmit={handelSubmit}>
            <h1 className={styles.title}>Spirit Code</h1>
            <input
                type="text"
                placeholder="Ваше имя"
                value={name}
                onChange={(e) => { setName(e.target.value); setError('') }}
            />
            <div className={styles.roles}>
            <button type="button" className={`${styles.role} ${role === 'student' ? styles.active : ''}`} onClick={() => setRole('student')}>
                Я ученик
            </button>
            <button type="button" className={`${styles.role} ${role === 'teacher' ? styles.active : ''}`} onClick={() => setRole('teacher')}>
                Я учитель
            </button>
            </div>
            {error && <p className={styles.error}>{error}</p>}

            <button type="submit" className={styles.submit}>
                Войти
            </button>
            </form>
    )
}

export default LoginForm