import { Link } from 'react-router-dom'
import type { Assignment, User } from '../../types'
import styles from './Assingment.module.css'

interface Props {
  assignment: Assignment
  user: User
  onDelete?: (id: number) => void
}

function AssignmentCard({ assignment, user, onDelete }: Props) {
  const isTeacher = user.role === 'teacher'

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
        <span className={styles.subject}>{assignment.subject}</span>
        <h3 className={styles.title}>{assignment.title}</h3>
        <p className={styles.deadline}>Сдать до: {assignment.deadline}</p>
        <span className={styles.open}>Открыть →</span>
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