import type { RunMessage, RunRequest } from './pythonWorker'
import type { TurtleDrawing } from './pyTurtle'

// Запуск Python-программы в фоновом потоке (см. pythonWorker.ts).
// Поток один на вкладку: Python загружается один раз (~10 МБ, потом из кэша браузера).
// Программу, которая работает слишком долго или которую остановили, обрываем вместе с потоком.

export const RUN_TIME_LIMIT_MS = 10_000
const MAX_OUTPUT = 100_000 // знаков вывода — дальше обрезаем, чтобы не повесить страницу

export interface RunHandlers {
  onLoading?: () => void // первый запуск: загружается Python
  onStarted?: () => void // программа начала выполняться
  onOutput: (text: string, isError: boolean) => void
  onTurtle?: (drawing: TurtleDrawing) => void // программа рисовала черепахой
  onFinish: (result: { ok: boolean; error?: string; stopped?: 'timeout' | 'user' }) => void
}

let worker: Worker | null = null
let nextId = 1
let current: { id: number; handlers: RunHandlers; timer?: ReturnType<typeof setTimeout>; outputSize: number } | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./pythonWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<RunMessage>) => handleMessage(e.data)
    // Сам поток не запустился (ошибка в его коде) — это не интернет; подробности в консоли
    worker.onerror = (e) => {
      e.preventDefault()
      console.error('Python worker:', e.message, e.filename, e.lineno)
      finish({ ok: false, error: 'Не удалось запустить Python в этом браузере. Обновите страницу и попробуйте ещё раз.' })
      killWorker()
    }
  }
  return worker
}

function killWorker() {
  worker?.terminate()
  worker = null
}

function finish(result: Parameters<RunHandlers['onFinish']>[0]) {
  if (!current) return
  clearTimeout(current.timer)
  const { handlers } = current
  current = null
  handlers.onFinish(result)
}

function handleMessage(msg: RunMessage) {
  if (!current || msg.id !== current.id) return
  const run = current
  switch (msg.type) {
    case 'loading':
      run.handlers.onLoading?.()
      break
    case 'started':
      run.handlers.onStarted?.()
      // Время считаем с начала выполнения, а не с загрузки Python
      run.timer = setTimeout(() => {
        killWorker()
        finish({ ok: false, stopped: 'timeout' })
      }, RUN_TIME_LIMIT_MS)
      break
    case 'out':
    case 'err': {
      if (run.outputSize >= MAX_OUTPUT) break
      const text = msg.text.slice(0, MAX_OUTPUT - run.outputSize)
      run.outputSize += text.length
      run.handlers.onOutput(text, msg.type === 'err')
      if (run.outputSize >= MAX_OUTPUT) run.handlers.onOutput('\n… вывод слишком длинный, дальше не показан\n', true)
      break
    }
    case 'turtle':
      run.handlers.onTurtle?.(msg.drawing)
      break
    case 'done':
      finish({ ok: true })
      break
    case 'error':
      finish({ ok: false, error: msg.text })
      break
  }
}

// Запускает программу; прошлый незавершённый запуск останавливается
export function runPython(code: string, stdin: string, handlers: RunHandlers) {
  if (current) stopPython()
  const id = nextId++
  current = { id, handlers, outputSize: 0 }
  const request: RunRequest = { id, code, stdin }
  getWorker().postMessage(request)
  return id
}

export function stopPython(id?: number) {
  if (!current || (id !== undefined && current.id !== id)) return
  killWorker()
  finish({ ok: false, stopped: 'user' })
}
