import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import styles from './BankTaskForm.module.css'
import LatexEditor from '../LatexEditor/LatexEditor'
import * as api from '../../services/api'

const MAX_NUMBER = 27 // как BankTask.MAX_NUMBER на сервере
const NUMBERS = Array.from({ length: MAX_NUMBER }, (_, i) => i + 1)

// Учитель: добавление задачи в базу заданий ЕГЭ
function BankTaskForm() {
  const [isOpen, setIsOpen] = useState(false) // по умолчанию свёрнута, как другие панели
  const [number, setNumber] = useState('')
  const [latex, setLatex] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [added, setAdded] = useState<number | null>(null) // номер последней добавленной задачи
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const n = Number(number)
    if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER) {
      setError('Выберите номер задания ЕГЭ')
      return
    }
    if (!latex.trim()) {
      setError('Введите условие задачи')
      return
    }

    setIsSaving(true)
    try {
      await api.createBankTask({ number: n, latex, answer: answer.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить задачу')
      return
    } finally {
      setIsSaving(false)
    }
    // Номер оставляем — часто добавляют несколько задач одного номера подряд
    setAdded(n)
    setLatex('')
    setAnswer('')
    setError('')
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h2>База заданий</h2>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
        >
          {isOpen ? 'Свернуть ▲' : 'Развернуть ▼'}
        </button>
      </div>

      {isOpen && (
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Номер задания ЕГЭ
            <select
              value={number}
              onChange={(e) => {
                setNumber(e.target.value)
                setError('')
              }}
            >
              <option value="" disabled>
                Выберите номер
              </option>
              {NUMBERS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <LatexEditor
            label="Условие (LaTeX)"
            value={latex}
            onChange={(value) => {
              setLatex(value)
              setError('')
            }}
          />

          <label className={styles.label}>
            Ответ (необязательно)
            <input type="text" value={answer} maxLength={500} onChange={(e) => setAnswer(e.target.value)} />
          </label>

          {error && <p className={styles.error}>{error}</p>}
          {added !== null && !error && <p className={styles.hint}>✓ Задача к заданию {added} добавлена в базу</p>}

          <button type="submit" className={styles.submit} disabled={isSaving}>
            {isSaving ? 'Сохраняем...' : 'Добавить в базу'}
          </button>
          <Link to="/tasks-bank" className={styles.link}>
            Открыть базу заданий →
          </Link>
        </form>
      )}
    </section>
  )
}

export default BankTaskForm
