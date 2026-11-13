import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import styles from './HomePage.module.css'
import type { Account, Assignment, CommentActions, NewAssignment, ReviewStatus, Subject, User } from '../../types'
import AssignmentCard from '../../components/AssignmentCard/AssignmentCard'
import StudentLessons, { MistakesList } from '../../components/StudentLessons/StudentLessons'
import LessonCalendar from '../../components/LessonCalendar/LessonCalendar'
import StreakCard from '../../components/StreakCard/StreakCard'
import SubjectSwitcher, { type SubjectOption } from '../../components/SubjectSwitcher/SubjectSwitcher'
import SiteHeader from '../../components/SiteHeader/SiteHeader'
import CallsBar from '../../components/CallsBar/CallsBar'
import AssignmentForm from '../../components/AssignmentForm/AssignmentForm'
import StudentsPanel from '../../components/StudentsPanel/StudentsPanel'
import AnswersPanel from '../../components/AnswersPanel/AnswersPanel'
import ProgressDonut from '../../components/ProgressDonut/ProgressDonut'
import PaymentsPanel from '../../components/PaymentsPanel/PaymentsPanel'
import ChatWindow from '../../components/ChatWindow/ChatWindow'
import StudentsList from '../../components/StudentsList/StudentsList'
import { hasSubject, lessonForSubjects, lessonSubjects, normalize, uniqueSubjects } from '../../utils/subjects'
import { awaitsReview, mistakesOf } from '../../utils/studentStats'
import { canReview } from '../../utils/roles'
import { usePush } from '../../utils/push'

interface Props {
  user: User | null;
  onLogout: () => void;
  items: Assignment[];
  accounts: Account[];
  onDelete: (id: number) => void;
  onAddStudent: (student: Omit<Account, 'id'>) => Promise<void>;
  onDeleteStudent: (id: number) => void;
  onSetSubjects: (id: number, subjects: string[]) => void;
  onSetCuratorStudents: (id: number, students: number[]) => Promise<void>;
  onReview: (assignmentId: number, answerId: number, status: ReviewStatus) => Promise<void>;
  commentActions: CommentActions;
  onAdd: (data: NewAssignment) => Promise<void>;
  subjects: Subject[]; // предметы в списках выбора (у учителя)
  onDeleteSubject: (id: number) => Promise<void>;
}

function HomePage({
  user,
  onLogout,
  items,
  onAdd,
  onDelete,
  accounts,
  onAddStudent,
  onDeleteStudent,
  onSetSubjects,
  onSetCuratorStudents,
  onReview,
  commentActions,
  subjects,
  onDeleteSubject,
}: Props) {
  // Открытая переписка (у учителя): показывается вместо колонки с заданиями
  const [openChat, setOpenChat] = useState<{ assignmentId: number; answerId: number } | null>(null)
  // Окно «Все задания» (у учителя)
  const [showAll, setShowAll] = useState(false)
  // Ученику: «Работа над ошибками» вместо уроков (оранжевая кнопка «РНО» рядом с выбором курса)
  const [showMistakes, setShowMistakes] = useState(false)
  const closeChat = useCallback(() => setOpenChat(null), [])
  // Предмет, уроки которого ученик смотрит на главной. Выбор запоминаем в браузере
  // У учителя и куратора выбор хранится отдельно (у них есть «Все предметы»)
  const subjectKey = canReview(user?.role) ? TEACHER_SUBJECT_KEY : SUBJECT_KEY
  const [chosenSubject, setChosenSubject] = useState(() => readSubject(subjectKey))
  const chooseSubject = (name: string) => {
    setChosenSubject(name)
    saveSubject(subjectKey, name)
  }

  // Сколько уроков в одной строке на ПК. Выбор запоминаем в браузере
  const [perRow, setPerRow] = useState(() => readPerRow(PER_ROW_KEY))
  const changePerRow = (value: number) => {
    setPerRow(value)
    savePerRow(PER_ROW_KEY, value)
  }
  // В окне «Все задания» — своя настройка, окно шире колонки на странице
  const [allPerRow, setAllPerRow] = useState(() => readPerRow(ALL_PER_ROW_KEY))
  const changeAllPerRow = (value: number) => {
    setAllPerRow(value)
    savePerRow(ALL_PER_ROW_KEY, value)
  }

  // Окно закрывается по Esc, страница под ним не прокручивается
  useEffect(() => {
    if (!showAll) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowAll(false)
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [showAll])

  if (!user) {
    return <Navigate to="/" replace />
  }

  const isTeacher = user.role === 'teacher'
  // Куратор видит то же, что учитель, но без создания уроков, учеников, оплаты и созвонов
  const isReviewer = canReview(user.role)

  // Предметы ученика берём из актуального списка аккаунтов,
  // чтобы изменения учителя применялись сразу
  const account = accounts.find((a) => normalize(a.name) === normalize(user.name))
  const mySubjects = account?.subjects ?? []

  // Ученик смотрит уроки одного предмета — переключатель справа от приветствия.
  // Не выбран или предмет убрали — первый предмет, где есть уроки
  const isTodo = (item: Assignment) => !item.student_homeworks?.[0] || item.student_homeworks[0].status === 'rejected'
  // Создатель платформы (и куратор) — «Все предметы» и все предметы; другой учитель — только предметы,
  // которые создал сам. В списке — сколько ответов ждут проверки
  const reviewCount = (lessons: Assignment[]) =>
    lessons.flatMap((item) => item.student_homeworks ?? []).filter(awaitsReview).length
  const reviewOption = (name: string): SubjectOption => {
    const lessons = items.filter((item) => lessonForSubjects([name], item))
    return { name, total: lessons.length, todo: reviewCount(lessons) }
  }
  const ownOnly = isTeacher && !account?.is_owner
  const subjectOptions: SubjectOption[] = ownOnly
    ? uniqueSubjects(subjects.filter((s) => s.created_by === user.id).map((s) => s.name)).map(reviewOption)
    : isReviewer
    ? [
        { name: ALL_SUBJECTS, total: items.length, todo: reviewCount(items) },
        ...uniqueSubjects([...subjects.map((s) => s.name), ...items.flatMap(lessonSubjects)]).map(reviewOption),
      ]
    : uniqueSubjects(mySubjects).map((name) => {
        const lessons = items.filter((item) => lessonForSubjects([name], item))
        return { name, total: lessons.length, todo: lessons.filter(isTodo).length }
      })
  const currentSubject =
    subjectOptions.find((o) => normalize(o.name) === normalize(chosenSubject))?.name ??
    (isReviewer && !ownOnly ? ALL_SUBJECTS : subjectOptions.find((o) => o.total > 0)?.name) ??
    subjectOptions[0]?.name
  const allSubjects = isReviewer && !ownOnly && currentSubject === ALL_SUBJECTS

  const visibleItems = allSubjects
    ? items
    : currentSubject
      ? items.filter((item) => lessonForSubjects([currentSubject], item))
      : []
  // Учителю — ученики выбранного предмета (учителя и кураторы остаются: по ним подписаны ответы)
  const visibleAccounts = allSubjects || !currentSubject
    ? accounts
    : accounts.filter((a) => a.role !== 'student' || (currentSubject !== undefined && hasSubject(a.subjects, currentSubject)))

  // Сданными считаем ДЗ, которые учитель отметил «Сдано».
  // Ученику сервер присылает только его собственный ответ.
  const acceptedCount = visibleItems.filter(
    (item) => item.student_homeworks?.[0]?.status === 'accepted'
  ).length

  // Ученику — сколько заданий ещё ждут решения (не отправлены или «Не сдано»),
  // учителю — сколько ответов ждут проверки
  const rejectedCount = visibleItems.filter(
    (item) => item.student_homeworks?.[0]?.status === 'rejected'
  ).length
  const todoCount =
    visibleItems.filter((item) => !item.student_homeworks?.[0]).length + rejectedCount
  const pendingReviewCount = reviewCount(visibleItems)

  // Предметы для учеников и созвонов — список с сервера (можно удалять в форме урока)
  const subjectList = subjects.map((s) => s.name)

  const lead = isReviewer
    ? pendingReviewCount > 0
      ? `${plural(pendingReviewCount, 'ответ ждёт', 'ответа ждут', 'ответов ждут')} проверки.`
      : 'Все ответы учеников проверены.'
    : todoCount > 0
      ? `${plural(todoCount, 'задание ждёт', 'задания ждут', 'заданий ждут')} решения.`
      : 'Все задания отправлены — так держать.'

  // Сортируем по ID в обратном порядке (последние добавленные первыми)
  const sortedItems = [...visibleItems].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
  const mistakeCount = isReviewer ? 0 : mistakesOf(sortedItems).length
  const mistakesOpen = showMistakes && !isReviewer

  function openMistakes() {
    setShowMistakes(true)
    // На телефоне уроки ниже приветствия и календаря — прокручиваем к списку
    requestAnimationFrame(() => document.getElementById('lessons')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const renderGrid = (children: ReactNode) => (
    <div
      className={`${styles.grid} ${styles.gridFixed}`}
      style={{ '--per-row': perRow } as CSSProperties}
      data-per-row={perRow}
    >
      {children}
    </div>
  )

  const emptyMessage = isReviewer
    ? allSubjects
      ? 'Заданий пока нет'
      : currentSubject
        ? `По предмету «${currentSubject}» заданий пока нет`
        : 'У вас пока нет своих предметов — создайте урок по новому предмету'
    : mySubjects.length === 0
      ? 'Учитель пока не назначил вам предметы'
      : `По предмету «${currentSubject}» уроков пока нет`

  // Задание и ответ для открытого чата берём из актуального списка —
  // так новые сообщения и отметки сразу видны в окне. Если ответ удалён, чата нет.
  const chatAssignment = openChat ? items.find((a) => a.id === openChat.assignmentId) : undefined
  const chatAnswer = chatAssignment?.student_homeworks?.find((sh) => sh.id === openChat?.answerId)
  const chat = chatAssignment && chatAnswer ? { assignment: chatAssignment, answer: chatAnswer } : null

  const assignmentsSection = (
    <section id="lessons" className={styles.assignmentsColumn}>
      {/* Заголовок слева, справа — выбор числа уроков в строке (только на ПК) */}
      <div className={`${styles.headingRow} ${isReviewer ? styles.headingRowTeacher : ''}`}>
        {!isReviewer && <h2 className={styles.heading}>Задания</h2>}
        {sortedItems.length > 0 && (
          <PerRowSwitch value={perRow} onChange={changePerRow} />
        )}
      </div>

      {mistakesOpen ? (
        <MistakesList items={sortedItems} renderGrid={renderGrid} onClose={() => setShowMistakes(false)} />
      ) : sortedItems.length === 0 ? (
        <p>{emptyMessage}</p>
      ) : (
        // Ученику: папки-темы карточками в порядке учителя; при смене предмета папка закрывается
        <StudentLessons
          key={currentSubject}
          items={sortedItems}
          renderGrid={renderGrid}
          renderLesson={(item) => (
            <AssignmentCard key={item.id} assignment={item} user={user} onDelete={isTeacher ? onDelete : undefined} />
          )}
        />
      )}
    </section>
  )

  return (
    <div className={styles.page}>
      <SiteHeader
        user={user}
        current={mistakesOpen ? 'mistakes' : 'home'}
        onLogout={onLogout}
        onHome={() => {
          setShowMistakes(false)
          requestAnimationFrame(() => document.getElementById('lessons')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
        }}
        subjectSwitcher={
          // Ученик выбирает предмет: уроки и прогресс на главной — по нему
          currentSubject && (
            <SubjectSwitcher
              options={subjectOptions}
              value={currentSubject}
              onChange={chooseSubject}
              todoLabel={isReviewer ? 'ждут проверки' : undefined}
            />
          )
        }
        // Ученику: все неверно решённые номера выбранного курса
        mistakes={
          !isReviewer && currentSubject
            ? { count: mistakeCount, onToggle: () => (mistakesOpen ? setShowMistakes(false) : openMistakes()) }
            : undefined
        }
      />

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.welcome}>
            <h1 className={styles.greeting}>Добро пожаловать, {user.name}</h1>
            {/* Непроверенные ответы учеников — красным, чтобы учитель сразу заметил */}
            <p className={`${styles.lead} ${isReviewer && pendingReviewCount > 0 ? styles.leadAlert : ''}`}>{lead}</p>
            {/* Серия дней; перечитывается, когда обновились уроки и ответы */}
            {user.role === 'student' && <StreakCard refreshKey={items} />}
            {user.role === 'student' && <PushBanner />}
            {isReviewer && (
              <button type="button" className={styles.allButton} onClick={() => setShowAll(true)}>
                Посмотреть все задания
              </button>
            )}
          </div>
          {/* Календарь занятий: у ученика — по выбранному предмету, у учителя и куратора — все уроки */}
          <LessonCalendar lessons={visibleItems} />
          {!isTeacher && (
            <div className={styles.progressCard}>
              <ProgressDonut done={acceptedCount} total={visibleItems.length} size={120} />
              <div className={styles.progressText}>
                <span className={styles.progressLabel}>Прогресс</span>
                <span className={styles.progressValue}>
                  {plural(acceptedCount, 'задание принято', 'задания принято', 'заданий принято')}
                </span>
                <span className={styles.progressNote}>
                  {rejectedCount > 0 ? `${rejectedCount} на доработке` : `всего ${visibleItems.length}`}
                </span>
              </div>
            </div>
          )}
        </section>

        {user.role !== 'curator' ? (
          <CallsBar
            isTeacher={isTeacher}
            subjects={subjectList}
            students={accounts.filter((a) => a.role === 'student' && a.id != null)}
            lessons={isTeacher ? items : []}
          />
        ) : null}

        {isReviewer ? (
          // Учитель: форма | ответы и ученики | список учеников (уроки — кнопкой «Посмотреть все задания»)
          <div className={styles.tools}>
            {isTeacher && <AssignmentForm onAdd={onAdd} subjects={subjects} onDeleteSubject={onDeleteSubject} items={items} />}
            <div className={styles.sideColumn}>
              <AnswersPanel
                items={visibleItems}
                accounts={accounts}
                onReview={onReview}
                activeAnswerId={chat?.answer.id}
                onOpenChat={(assignmentId, answerId) => setOpenChat({ assignmentId, answerId })}
              />
              {isTeacher && (
                <>
                  <PaymentsPanel accounts={accounts} />
                  <StudentsPanel
                    accounts={accounts}
                    currentUserId={user.id}
                    isOwner={Boolean(accounts.find((a) => a.id === user.id)?.is_owner)}
                    availableSubjects={subjectList}
                    onAddStudent={onAddStudent}
                    onDeleteStudent={onDeleteStudent}
                    onSetSubjects={onSetSubjects}
                    onSetCuratorStudents={onSetCuratorStudents}
                  />
                </>
              )}
            </div>
            {chat ? (
              <div className={styles.assignmentsColumn}>
                <ChatWindow
                  key={chat.answer.id}
                  assignment={chat.assignment}
                  answer={chat.answer}
                  currentUserId={user.id}
                  commentActions={commentActions}
                  onClose={closeChat}
                />
              </div>
            ) : (
              <div className={styles.assignmentsColumn}>
                <StudentsList accounts={visibleAccounts} items={visibleItems} />
              </div>
            )}
          </div>
        ) : (
          assignmentsSection
        )}
      </main>

      {showAll && (
        <div className={styles.modalBackdrop} onClick={() => setShowAll(false)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Все задания"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Все задания · {sortedItems.length}</h2>
              {sortedItems.length > 0 && (
                <PerRowSwitch value={allPerRow} onChange={changeAllPerRow} />
              )}
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Закрыть"
                onClick={() => setShowAll(false)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {sortedItems.length === 0 ? (
                <p>{emptyMessage}</p>
              ) : (
                <div
                  className={`${styles.grid} ${styles.gridFixed}`}
                  style={{ '--per-row': allPerRow } as CSSProperties}
                  data-per-row={allPerRow}
                >
                  {sortedItems.map((item) => (
                    <AssignmentCard key={item.id} assignment={item} user={user} onDelete={isTeacher ? onDelete : undefined} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 1 задание, 2 задания, 5 заданий
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  const word =
    mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many
  return `${n} ${word}`
}

// Иконка базы заданий: раскрытая книга, контур цвета текста ссылки
const PER_ROW_KEY = 'spirit.lessonsPerRow'
const ALL_PER_ROW_KEY = 'spirit.allLessonsPerRow'
const PER_ROW_OPTIONS = [1, 3, 5, 7]
const PER_ROW_DEFAULT = 3

function readPerRow(key: string): number {
  try {
    const value = Number(localStorage.getItem(key))
    return PER_ROW_OPTIONS.includes(value) ? value : PER_ROW_DEFAULT
  } catch {
    return PER_ROW_DEFAULT
  }
}

function savePerRow(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // без localStorage просто не запоминаем
  }
}

// Переключатель «Уроков в строке» (только на ПК)
function PerRowSwitch({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className={styles.perRow} role="group" aria-label="Уроков в строке">
      <span className={styles.perRowLabel}>Уроков в строке:</span>
      {PER_ROW_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={`${styles.perRowButton} ${value === option ? styles.perRowActive : ''}`}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  )
}


export default HomePage

// Ученику: включить уведомления о начале урока — приходят, даже когда сайт закрыт
function PushBanner() {
  const { state, error, busy, enable } = usePush()
  if (state === null || state === 'on' || state === 'unsupported') return null
  return (
    <div className={styles.pushBanner}>
      {state === 'off' && (
        <>
          <span>🔔 Узнавайте о начале урока, даже когда сайт закрыт</span>
          <button type="button" className={styles.pushButton} onClick={() => void enable()} disabled={busy}>
            {busy ? 'Включаем…' : 'Включить уведомления'}
          </button>
        </>
      )}
      {state === 'needs-install' && (
        <span>
          🔔 Чтобы получать уведомления о начале урока на iPhone, добавьте сайт на экран «Домой»:
          «Поделиться» → «На экран „Домой“», и откройте его оттуда
        </span>
      )}
      {state === 'denied' && (
        <span>🔕 Уведомления запрещены. Разрешите их для этого сайта в настройках браузера</span>
      )}
      {error && <span className={styles.pushError}>{error}</span>}
    </div>
  )
}

// Выбранный предмет на главной: у ученика и у учителя — свой
const SUBJECT_KEY = 'spirit.home.subject'
const TEACHER_SUBJECT_KEY = 'spirit.home.teacherSubject'
const ALL_SUBJECTS = 'Все предметы' // пункт учителя: без фильтра

function readSubject(key: string) {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function saveSubject(key: string, name: string) {
  try {
    localStorage.setItem(key, name)
  } catch {
    // без localStorage выбор просто не запомнится
  }
}
