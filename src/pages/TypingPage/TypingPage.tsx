import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import styles from './TypingPage.module.css'
import type { TypingResult, TypingStats, User } from '../../types'
import * as api from '../../services/api'
import TypingTrainer from '../../components/TypingTrainer/TypingTrainer'
import TypingHistory from '../../components/TypingHistory/TypingHistory'
import TypingResultsPanel from '../../components/TypingResultsPanel/TypingResultsPanel'

interface Props {
  user: User | null
}

type SaveState =
  | { kind: 'saving' }
  | { kind: 'saved'; result: TypingResult; previousBest: number | null }
  | { kind: 'error'; message: string }

function TypingPage({ user }: Props) {
  const isTeacher = user?.role === 'teacher'
  const [history, setHistory] = useState<TypingResult[] | null>(null)
  const [saveState, setSaveState] = useState<SaveState | null>(null)

  // Ученик видит свои прошлые попытки
  useEffect(() => {
    if (!user || isTeacher) return
    let cancelled = false
    api
      .getTypingResults()
      .then((list) => {
        if (!cancelled) setHistory(list)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [user, isTeacher])

  // Результаты сохраняются только у учеников — учитель тренируется «вхолостую»
  const handleFinish = useCallback(
    async (stats: TypingStats) => {
      if (isTeacher) return
      // Рекорд сравниваем только с попытками в том же режиме: ЕГЭ и русские слова несравнимы
      const sameMode = (history ?? []).filter((r) => r.language === stats.language)
      const previousBest = sameMode.length > 0 ? Math.max(...sameMode.map((r) => r.wpm)) : null
      setSaveState({ kind: 'saving' })
      try {
        const result = await api.saveTypingResult(stats)
        setHistory((prev) => [result, ...(prev ?? [])])
        setSaveState({ kind: 'saved', result, previousBest })
      } catch (err) {
        setSaveState({ kind: 'error', message: err instanceof Error ? err.message : 'Не удалось сохранить результат' })
      }
    },
    [isTeacher, history]
  )

  if (!user) {
    return <Navigate to="/" replace />
  }

  let resultNote: React.ReactNode = null
  if (isTeacher) {
    resultNote = 'Результаты учителя не сохраняются'
  } else if (saveState?.kind === 'saving') {
    resultNote = 'Сохраняем результат...'
  } else if (saveState?.kind === 'error') {
    resultNote = <span className={styles.error}>{saveState.message}</span>
  } else if (saveState?.kind === 'saved') {
    const { result, previousBest } = saveState
    resultNote =
      previousBest === null
        ? '✓ Результат сохранён — учитель его увидит'
        : result.wpm > previousBest
          ? `🏆 Новый рекорд! Было ${previousBest} слов/мин`
          : `✓ Результат сохранён. Ваш рекорд в этом режиме — ${previousBest} слов/мин`
  }

  const best = history && history.length > 0 ? Math.max(...history.map((r) => r.wpm)) : null

  return (
    <div className={styles.page}>
      <Link to="/home" className={styles.back}>
        ← На главную
      </Link>
      <h1 className={styles.title}>Тренажёр печати</h1>
      <p className={styles.subtitle}>
        Печатайте слова и нажимайте пробел после каждого. Опечатку можно исправить до пробела — ошибкой считается только слово, отправленное с ошибкой. В «ЕГЭ сложный» набираются целые строки кода: строку отправляет Enter, а слово для скорости — 5 знаков.
      </p>

      <div className={styles.content}>
        {isTeacher && <TypingResultsPanel />}

        <TypingTrainer onFinish={handleFinish} resultNote={resultNote} />

        {!isTeacher && (
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>Мои результаты</h2>
              {best !== null && <span className={styles.best}>Рекорд: {best} слов/мин</span>}
            </div>
            {history === null ? <p className={styles.muted}>Загрузка...</p> : <TypingHistory results={history} />}
          </section>
        )}
      </div>
    </div>
  )
}

export default TypingPage
