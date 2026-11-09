import { useEffect, useRef, useState } from 'react'
import styles from './CodeRunner.module.css'
import { RUN_TIME_LIMIT_MS, runPython, stopPython } from '../../utils/runPython'
import type { TurtleDrawing } from '../../utils/pyTurtle'
import TurtleCanvas from './TurtleCanvas'

type RunState = 'idle' | 'loading' | 'running'

interface Chunk {
  text: string
  isError: boolean
}

// Кнопка «Запустить» под программой (Python): входные данные для input() и вывод программы.
// Программа выполняется в браузере того, кто нажал кнопку, — у ученика и у учителя
function CodeRunner({ code }: { code: string }) {
  const [stdin, setStdin] = useState('')
  const [showStdin, setShowStdin] = useState(false)
  const [state, setState] = useState<RunState>('idle')
  const [output, setOutput] = useState<Chunk[] | null>(null)
  const [status, setStatus] = useState('')
  const [drawing, setDrawing] = useState<TurtleDrawing | null>(null)
  const runIdRef = useRef<number | null>(null)

  // Ушли со страницы или закрыли задание — останавливаем свою программу
  useEffect(() => () => {
    if (runIdRef.current !== null) stopPython(runIdRef.current)
  }, [])

  function handleRun() {
    setOutput([])
    setDrawing(null)
    setStatus('')
    setState('running')
    let runStart = performance.now()
    runIdRef.current = runPython(code, stdin, {
      onLoading: () => setState('loading'),
      onStarted: () => {
        runStart = performance.now()
        setState('running')
      },
      onOutput: (text, isError) => setOutput((prev) => [...(prev ?? []), { text, isError }]),
      onTurtle: setDrawing,
      onFinish: ({ ok, error, stopped }) => {
        runIdRef.current = null
        setState('idle')
        if (error) setOutput((prev) => [...(prev ?? []), { text: error, isError: true }])
        const seconds = ((performance.now() - runStart) / 1000).toFixed(2)
        setStatus(
          stopped === 'timeout'
            ? `Остановлено: программа работала дольше ${RUN_TIME_LIMIT_MS / 1000} с`
            : stopped === 'user'
              ? 'Остановлено'
              : ok
                ? `Готово за ${seconds} с`
                : 'Ошибка'
        )
      },
    })
  }

  function handleStop() {
    if (runIdRef.current !== null) stopPython(runIdRef.current)
  }

  const busy = state !== 'idle'
  const empty = output !== null && output.length === 0 && !busy && !drawing

  return (
    <div className={styles.runner}>
      <div className={styles.toolbar}>
        {busy ? (
          <button type="button" className={styles.stop} onClick={handleStop}>
            ■ Остановить
          </button>
        ) : (
          <button type="button" className={styles.run} onClick={handleRun} disabled={!code.trim()}>
            ▶ Запустить
          </button>
        )}
        <button
          type="button"
          className={styles.stdinToggle}
          onClick={() => setShowStdin((v) => !v)}
          aria-expanded={showStdin}
        >
          Входные данные {showStdin ? '▲' : '▼'}
        </button>
        <span className={styles.status}>
          {state === 'loading' ? 'Загружаем Python… (только при первом запуске)' : state === 'running' ? 'Выполняется…' : status}
        </span>
      </div>

      {showStdin && (
        <textarea
          className={styles.stdin}
          rows={3}
          spellCheck={false}
          placeholder="Что программа прочитает через input() — по строке на каждый вызов"
          value={stdin}
          onChange={(e) => setStdin(e.target.value)}
        />
      )}

      {output !== null && (output.length > 0 || empty) && (
        <pre className={styles.output}>
          {empty ? (
            <span className={styles.muted}>Программа ничего не вывела</span>
          ) : (
            output.map((c, i) => (
              <span key={i} className={c.isError ? styles.error : undefined}>
                {c.text}
              </span>
            ))
          )}
        </pre>
      )}
      {drawing && <TurtleCanvas drawing={drawing} />}
    </div>
  )
}

export default CodeRunner
