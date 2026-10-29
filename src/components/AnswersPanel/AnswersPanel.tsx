import { useState } from 'react'
import { Link } from 'react-router-dom'
import styles from './AnswersPanel.module.css'
import type { Account, Assignment, ReviewStatus, StudentHomework } from '../../types'
import { ReviewButtons, StatusBadge } from '../AnswerStatus/AnswerStatus'
import { hasSubject } from '../../utils/subjects'

interface Props {
  items: Assignment[]
  accounts: Account[]
  onReview: (assignmentId: number, answerId: number, status: ReviewStatus) => Promise<void>
  activeAnswerId?: number // ответ, переписка по которому сейчас открыта
  ref?: React.Ref<HTMLElement> // по нему страница меряет высоту панели
  onOpenChat: (assignmentId: number, answerId: number) => void
}

interface Answer {
  assignment: Assignment
  answer: StudentHomework
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : ''
}

function AnswersPanel({ items, accounts, onReview, activeAnswerId, onOpenChat, ref }: Props) {
  const [isOpen, setIsOpen] = useState(false) // по умолчанию свёрнута, как другие панели
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const students = accounts.filter((a) => a.role === 'student')

  // Все ответы, разложенные по ученикам
  const answersByStudent = new Map<number, Answer[]>()
  for (const assignment of items) {
    for (const answer of assignment.student_homeworks ?? []) {
      if (answer.student === undefined) continue
      const list = answersByStudent.get(answer.student) ?? []
      list.push({ assignment, answer })
      answersByStudent.set(answer.student, list)
    }
  }
  for (const list of answersByStudent.values()) {
    list.sort((a, b) => (b.answer.submitted_at ?? '').localeCompare(a.answer.submitted_at ?? ''))
  }

  const totalAnswers = [...answersByStudent.values()].reduce((sum, list) => sum + list.length, 0)

  // Пока никого не выбрали — показываем первого ученика, у которого есть ответы
  const selected =
    students.find((s) => s.id === selectedId) ??
    students.find((s) => answersByStudent.has(s.id!)) ??
    students[0]

  const answers = selected ? answersByStudent.get(selected.id!) ?? [] : []
  const answeredIds = new Set(answers.map((a) => a.assignment.id))
  const acceptedCount = answers.filter((a) => a.answer.status === 'accepted').length
  const pendingCount = answers.filter((a) => (a.answer.status ?? 'pending') === 'pending').length
  const notSubmitted = selected
    ? items.filter((a) => hasSubject(selected.subjects, a.subject) && !answeredIds.has(a.id))
    : []

  return (
    <section ref={ref} className={styles.panel}>
      <div className={styles.header}>
        <h2>
          Ответы учеников <span className={styles.count}>({totalAnswers})</span>
        </h2>
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
        students.length === 0 ? (
          <p className={styles.empty}>Учеников пока нет</p>
        ) : (
          <>
            <div className={styles.students}>
              {students.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`${styles.student} ${s.id === selected?.id ? styles.active : ''}`}
                  onClick={() => setSelectedId(s.id!)}
                >
                  {s.name}
                  <span className={styles.badge}>{answersByStudent.get(s.id!)?.length ?? 0}</span>
                </button>
              ))}
            </div>

            {selected && (
              <>
                <p className={styles.summary}>
                  Прислано {answers.length} из {answers.length + notSubmitted.length} · сдано{' '}
                  {acceptedCount} · ждут проверки {pendingCount}
                </p>

                {answers.length === 0 ? (
                  <p className={styles.empty}>{selected.name} пока ничего не прислал(а)</p>
                ) : (
                  <ul className={styles.list}>
                    {answers.map(({ assignment, answer }) => (
                      <li key={answer.id} className={styles.card}>
                        <div className={styles.cardHeader}>
                          <Link to={`/assignment/${assignment.id}`} className={styles.title}>
                            {assignment.title}
                          </Link>
                          <span className={styles.date}>{formatDate(answer.submitted_at)}</span>
                        </div>
                        <div className={styles.meta}>
                          <span className={styles.subject}>{assignment.subject}</span>
                          <StatusBadge status={answer.status} />
                        </div>

                        {answer.description ? (
                          <p className={styles.description}>{answer.description}</p>
                        ) : (
                          <p className={styles.empty}>Без описания</p>
                        )}

                        {answer.files && answer.files.length > 0 && (
                          <ul className={styles.files}>
                            {answer.files.map((f) => (
                              <li key={f.id}>
                                <a className={styles.link} href={f.url} download={f.name}>
                                  📎 {f.name}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}

                        <ReviewButtons
                          status={answer.status}
                          onChange={(value) => onReview(assignment.id!, answer.id!, value)}
                        />

                        <button
                          type="button"
                          className={`${styles.threadToggle} ${activeAnswerId === answer.id ? styles.threadActive : ''}`}
                          onClick={() => onOpenChat(assignment.id!, answer.id!)}
                          aria-pressed={activeAnswerId === answer.id}
                        >
                          💬 Переписка ({answer.comments?.length ?? 0})
                          <span className={styles.chevron}>→</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {notSubmitted.length > 0 && (
                  <div className={styles.pending}>
                    <p className={styles.label}>Ещё не прислано:</p>
                    <ul className={styles.pendingList}>
                      {notSubmitted.map((a) => (
                        <li key={a.id}>
                          <Link to={`/assignment/${a.id}`} className={styles.link}>
                            {a.title}
                          </Link>
                          {a.deadline && <span className={styles.date}> · до {a.deadline}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </>
        )
      )}
    </section>
  )
}

export default AnswersPanel
