import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styles from './SiteHeader.module.css'
import type { User } from '../../types'
import { promptInstall, useCanInstall } from '../../utils/install'

// Раздел, который сейчас открыт, — его кнопка белая, остальные оранжевые
export type SiteSection = 'home' | 'mistakes' | 'typing'

interface Props {
  user: User
  current: SiteSection
  onLogout: () => void
  onHome?: () => void // главная: «Задания» закрывает РНО и прокручивает к заданиям
  subjectSwitcher?: ReactNode // главная: выбор курса
  mistakes?: { count: number; onToggle: () => void } // главная, ученик: кнопка «РНО»
}

// Шапка сайта во всю ширину: логотип, разделы, «Установить приложение», «Выйти»
function SiteHeader({ user, current, onLogout, onHome, subjectSwitcher, mistakes }: Props) {
  // Кнопка «Установить приложение» — пока сайт не установлен и браузер это умеет
  const canInstall = useCanInstall()
  const navClass = (section: SiteSection) =>
    `${styles.navLink} ${current === section ? styles.navActive : styles.navAccent}`

  return (
    <header className={styles.topbar}>
      <div className={styles.topbarInner}>
        <Link to="/home" className={styles.logo} onClick={onHome}>
          <span className={styles.logoMark} aria-hidden="true">&gt;_</span>
          Spirit Code
        </Link>
        <nav className={styles.nav} aria-label="Основная навигация">
          <Link
            to="/home"
            className={navClass('home')}
            aria-current={current === 'home' ? 'page' : undefined}
            onClick={onHome}
          >
            Задания
          </Link>
          {user.role === 'teacher' && (
            <Link to="/lessons" className={`${styles.navLink} ${styles.navAccent}`}>
              База уроков
            </Link>
          )}
          <Link
            to="/typing"
            className={navClass('typing')}
            aria-current={current === 'typing' ? 'page' : undefined}
          >
            Тренажёр печати
          </Link>
          {subjectSwitcher}
          {mistakes && (
            <button
              type="button"
              className={`${styles.navLink} ${styles.mistakesButton} ${current === 'mistakes' ? styles.navActive : ''}`}
              onClick={mistakes.onToggle}
              aria-pressed={current === 'mistakes'}
              title="Работа над ошибками: номера, решённые неверно"
            >
              РНО
              <span className={mistakes.count > 0 ? styles.mistakesCount : styles.mistakesZero}>{mistakes.count}</span>
            </button>
          )}
        </nav>
        {canInstall && (
          <button
            type="button"
            className={styles.install}
            onClick={() => void promptInstall()}
            title="Ярлык на рабочем столе и отдельное окно, как у обычной программы"
          >
            ⤓ Установить приложение
          </button>
        )}
        <button type="button" className={styles.logout} onClick={onLogout}>
          Выйти
        </button>
      </div>
    </header>
  )
}

export default SiteHeader
