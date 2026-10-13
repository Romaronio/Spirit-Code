import { Link } from 'react-router-dom'
import type { Assignment, User } from '../../types'
import styles from './Assingment.module.css'

interface Props {
  assignment: Assignment
  user: User
}

function AssignmentCard({ assignment, user }: Props) {
  return (
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
  )
}

export default AssignmentCard