/// <reference lib="webworker" />
// Выполнение Python-программ ученика прямо в браузере (Pyodide) — в отдельном потоке,
// чтобы зависшая программа не вешала страницу: её останавливают, завершая поток.
// Код идёт только на компьютере того, кто нажал «Запустить», — сервер его не видит.
// Поток — модуль (type: 'module'): так он одинаково работает и в разработке (Vite), и в сборке.

import { TURTLE_MODULE, type TurtleDrawing } from './pyTurtle'

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'

interface PyDict {
  set: (k: string, v: unknown) => void
  destroy: () => void
}

interface Pyodide {
  runPython: (code: string, options?: { globals?: unknown }) => unknown
  runPythonAsync: (code: string, options?: { globals?: unknown }) => Promise<unknown>
  loadPackagesFromImports: (code: string) => Promise<void>
  setStdout: (options: { batched: (text: string) => void }) => void
  setStderr: (options: { batched: (text: string) => void }) => void
  setStdin: (options: { stdin: () => string | undefined }) => void
  globals: { get: (name: string) => () => PyDict }
  FS: { mkdirTree: (path: string) => void; writeFile: (path: string, data: string) => void }
}

export type RunRequest = { id: number; code: string; stdin: string }
export type RunMessage =
  | { id: number; type: 'loading' }
  | { id: number; type: 'started' }
  | { id: number; type: 'out' | 'err'; text: string }
  | { id: number; type: 'turtle'; drawing: TurtleDrawing }
  | { id: number; type: 'done' }
  | { id: number; type: 'error'; text: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope
let pyodidePromise: Promise<Pyodide> | null = null

// Папка со своей черепахой — первой в пути поиска модулей
const SHIM_DIR = '/spirit'

async function loadPython(): Promise<Pyodide> {
  const mod = (await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)) as {
    loadPyodide: (options: { indexURL: string }) => Promise<Pyodide>
  }
  const py = await mod.loadPyodide({ indexURL: PYODIDE_URL })
  py.FS.mkdirTree(SHIM_DIR)
  py.FS.writeFile(`${SHIM_DIR}/turtle.py`, TURTLE_MODULE)
  py.runPython(`import sys\nsys.path.insert(0, '${SHIM_DIR}')`)
  return py
}

function getPyodide(): Promise<Pyodide> {
  if (!pyodidePromise) {
    pyodidePromise = loadPython().catch((err) => {
      pyodidePromise = null // не загрузилось (нет интернета) — в следующий раз попробуем снова
      throw err
    })
  }
  return pyodidePromise
}

// Из ошибки Python оставляем только то, что относится к программе ученика
function cleanTraceback(message: string): string {
  const lines = message.split('\n')
  const start = lines.findIndex((l) => l.includes('File "<exec>"'))
  return start === -1 ? message.trim() : ['Traceback (most recent call last):', ...lines.slice(start)].join('\n').trim()
}

// Рисунок черепахи, если программа её использовала (в том числе до ошибки)
function turtleDrawing(py: Pyodide): TurtleDrawing | null {
  const json = py.runPython(`import sys\n_t = sys.modules.get('turtle')\n_t._export() if _t else ''`)
  return typeof json === 'string' && json ? (JSON.parse(json) as TurtleDrawing) : null
}

ctx.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { id, code, stdin } = e.data
  const post = (msg: RunMessage) => ctx.postMessage(msg)
  let py: Pyodide
  try {
    if (!pyodidePromise) post({ id, type: 'loading' })
    try {
      py = await getPyodide()
    } catch (err) {
      console.error('Pyodide:', err)
      post({ id, type: 'error', text: 'Не удалось загрузить Python. Проверьте интернет и попробуйте ещё раз.' })
      return
    }
    const inputLines = stdin.replace(/\r\n?/g, '\n').split('\n')
    if (inputLines[inputLines.length - 1] === '') inputLines.pop()
    py.setStdout({ batched: (text) => post({ id, type: 'out', text: text + '\n' }) })
    py.setStderr({ batched: (text) => post({ id, type: 'err', text: text + '\n' }) })
    py.setStdin({ stdin: () => inputLines.shift() })
    // Черепаха каждый раз начинает с чистого листа
    py.runPython(`import sys\nsys.modules.pop('turtle', None)`)
    await py.loadPackagesFromImports(code)
    post({ id, type: 'started' })
    // У каждого запуска свои переменные — прошлый запуск не влияет на новый
    const globals = py.globals.get('dict')()
    globals.set('__name__', '__main__')
    try {
      await py.runPythonAsync(code, { globals })
    } finally {
      globals.destroy()
      const drawing = turtleDrawing(py)
      if (drawing) post({ id, type: 'turtle', drawing })
    }
    post({ id, type: 'done' })
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    post({ id, type: 'error', text: cleanTraceback(text) })
  }
}
