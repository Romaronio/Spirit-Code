import { useState } from 'react'
import styles from './AnswerStatus.module.css'
import type { ReviewStatus, StudentHomework } from '../../types'
import { isClassworkOnly } from '../../utils/studentStats'

const LABELS: Record<ReviewStatus, string> = {
  pending: '⏳ На проверке',
  accepted: '✓ Сдано',
  rejected: '✗ Не сдано',
}

// Без отметки учителя ответ только с классной работой — не «На проверке»: её можно не решать
export function StatusBadge({ answer }: { answer: StudentHomework }) {
  const status = answer.status ?? 'pending'
  if (status === 'pending' && isClassworkOnly(answer)) {
    return <span className={`${styles.badge} ${styles.classwork}`}>Классная работа</span>
  }
  return <span className={`${styles.badge} ${styles[status]}`}>{LABELS[status]}</span>
}

interface ReviewProps {
  status?: ReviewStatus
  onChange: (status: ReviewStatus) => Promise<void>
}

// Кнопки учителя. Повторное нажатие на выбранную отметку снимает её
export function ReviewButtons({ status = 'pending', onChange }: ReviewProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleClick(value: Exclude<ReviewStatus, 'pending'>) {
    setIsSaving(true)
    setError('')
    try {
      await onChange(status === value ? 'pending' : value)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить отметку')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className={styles.review}>
      <button
        type="button"
        className={`${styles.button} ${status === 'accepted' ? styles.accepted : ''}`}
        onClick={() => handleClick('accepted')}
        disabled={isSaving}
        aria-pressed={status === 'accepted'}
      >
        ✓ Сдано
      </button>
      <button
        type="button"
        className={`${styles.button} ${status === 'rejected' ? styles.rejected : ''}`}
        onClick={() => handleClick('rejected')}
        disabled={isSaving}
        aria-pressed={status === 'rejected'}
      >
        ✗ Не сдано
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}

// Отметка учителя/куратора к одному заданию: верно / неверно. Повторное нажатие снимает отметку —
// тогда снова действует автопроверка
export function TaskMarkButtons({
  mark,
  onChange,
}: {
  mark?: boolean
  onChange: (mark: boolean | null) => Promise<void>
}) {
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleClick(value: boolean) {
    setIsSaving(true)
    setError('')
    try {
      await onChange(mark === value ? null : value)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить отметку')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className={styles.review}>
      <button
        type="button"
        className={`${styles.button} ${styles.small} ${mark === true ? styles.accepted : ''}`}
        onClick={() => handleClick(true)}
        disabled={isSaving}
        aria-pressed={mark === true}
        title="Отметить задание верным"
      >
        ✓ верно
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.small} ${mark === false ? styles.rejected : ''}`}
        onClick={() => handleClick(false)}
        disabled={isSaving}
        aria-pressed={mark === false}
        title="Отметить задание неверным"
      >
        ✗ неверно
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}
