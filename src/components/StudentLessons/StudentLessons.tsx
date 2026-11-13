import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styles from './StudentLessons.module.css'
import card from '../AssignmentCard/Assingment.module.css'
import { groupByTopic, topicLabel } from '../../utils/topics'
import { answerKeyTitle } from '../../utils/lessonTasks'
import { mistakesOf } from '../../utils/studentStats'
import type { Assignment } from '../../types'

// Уроки ученика на главной: папки-темы («№26», «Повторение»…) карточками, как уроки, в порядке учителя.
// Нажали на папку — внутри её уроки и «← Все темы».
// Неверно решённые номера — отдельно: кнопка «🔁 Ошибки» в шапке открывает MistakesList

const statusOf = (lesson: Assignment) => lesson.student_homeworks?.[0]?.status

interface Props {
  items: Assignment[]
  renderGrid: (children: ReactNode) => ReactNode // сетка карточек, как на главной
  renderLesson: (lesson: Assignment) => ReactNode // карточка урока
}

// «Работа над ошибками»: все неверно решённые номера карточками
export function MistakesList({
  items,
  renderGrid,
  onClose,
}: Pick<Props, 'items' | 'renderGrid'> & { onClose: () => void }) {
  const mistakes = mistakesOf(items)
  return (
    <div className={styles.wrap}>
      <div className={styles.folderBar}>
        <button type="button" className={styles.back} onClick={onClose}>
          ← К урокам
        </button>
        <h3 className={styles.folderTitle}>🔁 Работа над ошибками</h3>
      </div>
      {mistakes.length === 0 ? (
        <p className={styles.allFixed}>Все ошибки исправлены — так держать!</p>
      ) : (
        <>
          <p className={styles.hint}>
            Открой номер, исправь ответ и нажми «Отправить ответ» — верно решённый номер уйдёт из списка.
          </p>
          {renderGrid(
            mistakes.map(({ lesson, key }) => (
              <div key={`${lesson.id}-${key}`} className={card.cardWrapper}>
                <Link
                  to={`/assignment/${lesson.id}?task=${encodeURIComponent(key)}`}
                  className={`${card.card} ${card.cardLink} ${card.needsWork} ${styles.folderCard}`}
                >
                  <div className={card.top}>
                    <span className={card.subject}>🔁 Ошибка</span>
                    <span className={styles.badgeFix}>неверно</span>
                  </div>
                  <h3 className={card.title}>{answerKeyTitle(key)}</h3>
                  <div className={card.footer}>
                    <span className={card.deadline} title={lesson.title}>{lesson.title}</span>
                    <span className={card.open}>Решить →</span>
                  </div>
                </Link>
              </div>
            )),
          )}
        </>
      )}
    </div>
  )
}

function StudentLessons({ items, renderGrid, renderLesson }: Props) {
  const [openTopic, setOpenTopic] = useState<string | null>(null)
  const groups = groupByTopic(items)
  const opened = openTopic === null ? undefined : groups.find((g) => g.topic === openTopic)

  if (opened) {
    return (
      <div className={styles.wrap}>
        <div className={styles.folderBar}>
          <button type="button" className={styles.back} onClick={() => setOpenTopic(null)}>
            ← Все темы
          </button>
          <h3 className={styles.folderTitle}>📁 {topicLabel(opened.topic)}</h3>
        </div>
        {renderGrid(opened.lessons.map(renderLesson))}
      </div>
    )
  }

  return renderGrid(
    groups.map(({ topic, lessons }) => {
      const accepted = lessons.filter((a) => statusOf(a) === 'accepted').length
      const rejected = lessons.filter((a) => statusOf(a) === 'rejected').length
      const notSent = lessons.filter((a) => !a.student_homeworks?.[0]).length
      return (
        <div key={topic || '-'} className={card.cardWrapper}>
          <button
            type="button"
            className={`${card.card} ${card.cardLink} ${styles.folderCard} ${notSent + rejected > 0 ? card.needsWork : ''}`}
            onClick={() => setOpenTopic(topic)}
          >
            <div className={card.top}>
              <span className={card.subject}>📁 Папка</span>
              {rejected > 0 ? (
                <span className={styles.badgeFix}>на доработке: {rejected}</span>
              ) : (
                <span className={accepted === lessons.length ? styles.badgeDone : styles.badge}>
                  сдано {accepted} из {lessons.length}
                </span>
              )}
            </div>
            <h3 className={`${card.title} ${styles.folderName}`} title={topicLabel(topic)}>{topicLabel(topic)}</h3>
            <div className={card.footer}>
              <span className={card.deadline}>
                {lessons.length} {plural(lessons.length, 'урок', 'урока', 'уроков')}
                {notSent > 0 && ` · не отправлено: ${notSent}`}
              </span>
              <span className={card.open}>Открыть →</span>
            </div>
          </button>
        </div>
      )
    }),
  )
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export default StudentLessons
