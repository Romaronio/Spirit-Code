import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './TypingTrainer.module.css'
import type { TypingLanguage, TypingStats } from '../../types'
import { randomWords } from '../../utils/typingWords'

interface Props {
  // Вызывается один раз, когда время теста вышло
  onFinish: (stats: TypingStats) => void
  // Итог под результатом: «сохранено», ошибка, сравнение с рекордом
  resultNote?: React.ReactNode
}

const DURATIONS = [30, 60, 120]
const LANGUAGES: { value: TypingLanguage; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'ege', label: 'ЕГЭ лёгкий' },
  { value: 'ege_hard', label: 'ЕГЭ сложный' },
]

// Режимы с кодом: моноширинный шрифт, как в редакторе
const CODE_LANGUAGES: TypingLanguage[] = ['ege', 'ege_hard']

// В сложном ЕГЭ набирают целые строки кода с пробелами внутри: строка
// отправляется по Enter, а скорость считается в «словах» по 5 знаков
function isPhraseMode(language: TypingLanguage) {
  return language === 'ege_hard'
}
const WORDS_BATCH = 200

type Phase = 'idle' | 'running' | 'finished'

interface Counters {
  index: number // номер текущего слова
  marks: boolean[] // набрано ли без ошибки каждое пройденное слово
  correctWords: number
  correctChars: number
  keystrokes: number
  errors: number // слов (строк), отправленных с ошибкой
}

const EMPTY: Counters = { index: 0, marks: [], correctWords: 0, correctChars: 0, keystrokes: 0, errors: 0 }

// Точность — доля слов, набранных верно (так же считает сервер)
function accuracy(correctWords: number, wrongWords: number) {
  const total = correctWords + wrongWords
  return total ? Math.round((correctWords / total) * 1000) / 10 : 100
}

function perMinute(count: number, seconds: number) {
  return Math.round(count / (Math.max(seconds, 1) / 60))
}

// Слов в минуту: в обычных режимах — верные слова, в режиме строк — знаки / 5
// (так же считает сервер)
function wordsPerMinute(language: TypingLanguage, words: number, chars: number, seconds: number) {
  return perMinute(isPhraseMode(language) ? chars / 5 : words, seconds)
}

function TypingTrainer({ onFinish, resultNote }: Props) {
  const [language, setLanguage] = useState<TypingLanguage>('ru')
  const [duration, setDuration] = useState(60)
  const [words, setWords] = useState(() => randomWords('ru', WORDS_BATCH))
  const [phase, setPhase] = useState<Phase>('idle')
  const [input, setInput] = useState('')
  const [counters, setCounters] = useState<Counters>(EMPTY)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [final, setFinal] = useState<TypingStats | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLSpanElement>(null)

  // После окончания живые цифры считаем по полной длительности теста
  const elapsed = phase === 'running' ? (now - startedAt) / 1000 : phase === 'finished' ? duration : 0
  const timeLeft = phase === 'finished' ? 0 : Math.max(0, Math.ceil(duration - elapsed))
  const phraseMode = isPhraseMode(language)

  function restart(nextLanguage = language, nextDuration = duration) {
    setLanguage(nextLanguage)
    setDuration(nextDuration)
    setWords(randomWords(nextLanguage, WORDS_BATCH))
    setPhase('idle')
    setInput('')
    setCounters(EMPTY)
    setFinal(null)
    inputRef.current?.focus()
  }

  // Свежие значения для таймера: его колбэк создаётся один раз на тест
  const latest = useRef({ words, input, counters, language, onFinish })
  useEffect(() => {
    latest.current = { words, input, counters, language, onFinish }
  })

  // Часы тикают, пока идёт тест. Когда время вышло, недописанное слово
  // засчитываем, только если оно уже набрано верно.
  useEffect(() => {
    if (phase !== 'running') return
    const timer = setInterval(() => {
      const time = Date.now()
      setNow(time)
      if (time - startedAt < duration * 1000) return

      clearInterval(timer)
      const { words, input, counters, language, onFinish } = latest.current
      const word = words[counters.index]
      const lastCorrect = input === word
      const stats: TypingStats = {
        language,
        duration,
        correct_words: counters.correctWords + (lastCorrect ? 1 : 0),
        correct_chars: counters.correctChars + (lastCorrect ? word.length : 0),
        keystrokes: counters.keystrokes,
        errors: counters.errors,
      }
      setPhase('finished')
      setFinal(stats)
      onFinish(stats)
    }, 100)
    return () => clearInterval(timer)
  }, [phase, startedAt, duration])

  // Текущее слово всегда на первой или второй строке окна со словами
  useLayoutEffect(() => {
    const box = boxRef.current
    const current = currentRef.current
    if (!box || !current) return
    box.scrollTop = Math.max(0, current.offsetTop - current.offsetHeight)
  }, [counters.index, words])

  function handleChange(value: string) {
    if (phase === 'finished') return
    if (phase === 'idle') {
      if (!value.trim()) return
      const start = Date.now()
      setStartedAt(start)
      setNow(start)
      setPhase('running')
    }

    // Пробел — слово закончено (в режиме строк пробел — обычный символ)
    if (!phraseMode && value.endsWith(' ')) {
      submit(value)
      return
    }

    // Новые символы считаем нажатиями (сервер сверяет их со скоростью).
    // Неверная буква до пробела — не ошибка: её ещё можно стереть и исправить.
    if (value.length > input.length) {
      const added = value.length - input.length
      setCounters((c) => ({ ...c, keystrokes: c.keystrokes + added }))
    }
    setInput(value)
  }

  // Слово (строка) отправлено: засчитываем и переходим к следующему
  function submit(value: string) {
    const typed = value.trim()
    if (!typed) return
    const target = words[counters.index]
    const correct = typed === target
    setCounters((c) => ({
      index: c.index + 1,
      marks: [...c.marks, correct],
      correctWords: c.correctWords + (correct ? 1 : 0),
      correctChars: c.correctChars + (correct ? target.length + 1 : 0),
      keystrokes: c.keystrokes + 1,
      // ошибка — слово, которое не исправили до пробела (Enter)
      errors: c.errors + (correct ? 0 : 1),
    }))
    setInput('')
    if (counters.index + 50 > words.length) {
      setWords((list) => [...list, ...randomWords(language, WORDS_BATCH)])
    }
  }

  function renderCurrentWord(word: string) {
    const chars = word.split('').map((ch, i) => {
      const cls = i >= input.length ? '' : input[i] === ch ? styles.charOk : styles.charBad
      return (
        <span key={i} className={cls}>
          {ch}
        </span>
      )
    })
    // Лишние буквы сверх длины слова показываем красным
    const extra = input.slice(word.length)
    return (
      <>
        {chars}
        {extra && <span className={styles.charBad}>{extra}</span>}
      </>
    )
  }

  const liveWpm = wordsPerMinute(language, counters.correctWords, counters.correctChars, elapsed)
  const liveAccuracy = accuracy(counters.correctWords, counters.errors)

  return (
    <section className={styles.card}>
      <div className={styles.settings}>
        <div className={styles.group} role="group" aria-label="Язык">
          {LANGUAGES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`${styles.option} ${language === value ? styles.active : ''}`}
              onClick={() => restart(value, duration)}
              aria-pressed={language === value}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.group} role="group" aria-label="Длительность">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={`${styles.option} ${duration === d ? styles.active : ''}`}
              onClick={() => restart(language, d)}
              aria-pressed={duration === d}
            >
              {d < 60 ? `${d} с` : `${d / 60} мин`}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.live}>
        <span className={styles.timer}>{timeLeft} с</span>
        <span>{liveWpm} слов/мин</span>
        <span>точность {liveAccuracy}%</span>
      </div>

      <div
        ref={boxRef}
        className={[
          styles.words,
          CODE_LANGUAGES.includes(language) ? styles.code : '',
          phraseMode ? styles.phrases : '',
          phase === 'finished' ? styles.dimmed : '',
        ].join(' ')}
        onClick={() => inputRef.current?.focus()}
      >
        {words.map((word, i) => {
          if (i === counters.index) {
            return (
              <span key={i} ref={currentRef} className={`${styles.word} ${styles.current}`}>
                {renderCurrentWord(word)}
              </span>
            )
          }
          const mark = i < counters.index ? (counters.marks[i] ? styles.done : styles.missed) : ''
          return (
            <span key={i} className={`${styles.word} ${mark}`}>
              {word}
            </span>
          )
        })}
      </div>

      <div className={styles.inputRow}>
        <input
          ref={inputRef}
          className={`${styles.input} ${CODE_LANGUAGES.includes(language) ? styles.code : ''}`}
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') restart()
            if (e.key === 'Enter' && phraseMode && phase === 'running') {
              e.preventDefault()
              submit(input)
            }
          }}
          onPaste={(e) => e.preventDefault()}
          disabled={phase === 'finished'}
          placeholder={
            phase !== 'idle'
              ? ''
              : phraseMode
                ? 'Наберите строку и нажмите Enter — время пойдёт само'
                : 'Начните печатать — время пойдёт само'
          }
          aria-label="Поле для набора"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
        />
        <button type="button" className={styles.restart} onClick={() => restart()} title="Esc">
          ↻ Заново
        </button>
      </div>

      {final && (
        <div className={styles.result}>
          <div className={styles.bigNumber}>
            {wordsPerMinute(final.language, final.correct_words, final.correct_chars, final.duration)}
            <span>слов в минуту</span>
          </div>
          <div className={styles.resultDetails}>
            <span>{perMinute(final.correct_chars, final.duration)} знаков в минуту</span>
            <span>точность {accuracy(final.correct_words, final.errors)}%</span>
            {isPhraseMode(final.language) && <span>строк без ошибок: {final.correct_words}</span>}
            <span>{isPhraseMode(final.language) ? 'строк' : 'слов'} с ошибкой: {final.errors}</span>
          </div>
          {resultNote && <div className={styles.note}>{resultNote}</div>}
          <button type="button" className={styles.again} onClick={() => restart()}>
            Пройти ещё раз
          </button>
        </div>
      )}
    </section>
  )
}

export default TypingTrainer
