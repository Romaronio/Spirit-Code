import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import styles from './TasksBankPage.module.css'
import type { BankTask, User } from '../../types'
import * as api from '../../services/api'
import LatexDocument from '../../components/LatexDocument/LatexDocument'

interface Props {
  user: User | null
}

// База заданий ЕГЭ: задачи по номерам, ответ открывается по кнопке
function TasksBankPage({ user }: Props) {
  const [tasks, setTasks] = useState<BankTask[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number | null>(null) // null — все номера
  const [shownAnswers, setShownAnswers] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!user) return
    let cancelled = false
    api
      .getBankTasks()
      .then((list) => {
        if (!cancelled) setTasks(list)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить базу заданий')
      })
    return () => {
      cancelled = true
    }
  }, [user])

  if (!user) {
    return <Navigate to="/" replace />
  }

  const isTeacher = user.role === 'teacher'
  const numbers = [...new Set((tasks ?? []).map((t) => t.number))].sort((a, b) => a - b)
  const visible = (tasks ?? []).filter((t) => selected === null || t.number === selected)

  function toggleAnswer(id: number) {
    setShownAnswers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDelete(task: BankTask) {
    if (!window.confirm(`Удалить задачу к заданию ${task.number} из базы?`)) return
    try {
      await api.deleteBankTask(task.id)
      setTasks((prev) => (prev ?? []).filter((t) => t.id !== task.id))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Не удалось удалить задачу')
    }
  }

  return (
    <div className={styles.page}>
      <Link to="/home" className={styles.back}>
        ← На главную
      </Link>
      <h1 className={styles.title}>База заданий ЕГЭ</h1>
      <p className={styles.subtitle}>Выберите номер задания — ответ можно открыть после решения.</p>

      {error && <p className={styles.error}>{error}</p>}
      {!error && tasks === null && <p>Загрузка...</p>}
      {tasks !== null && tasks.length === 0 && (
        <section className={styles.card}>
          <p>{isTeacher ? 'База пока пуста — добавьте задачи в панели «База заданий» на главной.' : 'Задания скоро появятся.'}</p>
        </section>
      )}

      {numbers.length > 0 && (
        <div className={styles.filters}>
          <button
            type="button"
            className={`${styles.chip} ${selected === null ? styles.chipActive : ''}`}
            onClick={() => setSelected(null)}
          >
            Все
          </button>
          {numbers.map((n) => (
            <button
              key={n}
              type="button"
              className={`${styles.chip} ${selected === n ? styles.chipActive : ''}`}
              onClick={() => setSelected(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      <div className={styles.list}>
        {visible.map((task) => (
          <section key={task.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.badge}>Задание {task.number}</span>
              {isTeacher && (
                <button type="button" className={styles.delete} onClick={() => handleDelete(task)}>
                  Удалить
                </button>
              )}
            </div>
            <LatexDocument source={task.latex} />
            {task.answer && (
              <div className={styles.answerRow}>
                <button type="button" className={styles.answerToggle} onClick={() => toggleAnswer(task.id)}>
                  {shownAnswers.has(task.id) ? 'Скрыть ответ' : 'Показать ответ'}
                </button>
                {shownAnswers.has(task.id) && <span className={styles.answer}>{task.answer}</span>}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

export default TasksBankPage
