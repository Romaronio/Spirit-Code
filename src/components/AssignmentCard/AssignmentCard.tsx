import { Link } from 'react-router-dom'
import type { Assignment, User } from '../../types'
import styles from './Assingment.module.css'
import { StatusBadge } from '../AnswerStatus/AnswerStatus'

interface Props {
  assignment: Assignment
  user: User
  onDelete?: (id: number) => void
}

// '2026-10-25' → '25.10.2026'
function formatDeadline(value: string) {
  const [year, month, day] = value.split('-')
  return day && month && year ? `${day}.${month}.${year}` : value
}

function AssignmentCard({ assignment, user, onDelete }: Props) {
  const isTeacher = user.role === 'teacher'
  // Ученику сервер присылает только его собственный ответ
  const myAnswer = isTeacher ? undefined : assignment.student_homeworks?.[0]

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (window.confirm(`Удалить задание "${assignment.title}"?`)) {
      onDelete?.(assignment.id!)
    }
  }

  return (
    <div className={styles.cardWrapper}>
      <Link
        to={`/assignment/${assignment.id}`}
        state={user}
        className={`${styles.card} ${styles.cardLink}`}
      >
        <div className={`${styles.top} ${isTeacher && onDelete ? styles.withDelete : ''}`}>
          <span className={styles.subject} title={assignment.subject}>{assignment.subject}</span>
          {!isTeacher &&
            (myAnswer ? (
              <StatusBadge status={myAnswer.status} />
            ) : (
              <span className={styles.notSent}>Не отправлено</span>
            ))}
        </div>

        {/* Заголовок всегда занимает ровно две строки, длинный обрезается */}
        <h3 className={styles.title} title={assignment.title}>{assignment.title}</h3>

        <div className={styles.footer}>
          {assignment.deadline && (
            <span className={styles.deadline}>до {formatDeadline(assignment.deadline)}</span>
          )}
          <span className={styles.open}>Открыть →</span>
        </div>
      </Link>
      {isTeacher && onDelete && (
        <button
          type="button"
          className={styles.deleteButton}
          onClick={handleDelete}
          title="Удалить задание"
        >
          ✕
        </button>
      )}
    </div>
  )
}

export default AssignmentCard