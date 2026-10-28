import { useEffect, useState } from 'react'

// KaTeX (~300 КБ со шрифтами) грузим только когда на экране есть формула
export type Katex = typeof import('katex').default
let katexPromise: Promise<Katex> | null = null

function loadKatex() {
  katexPromise ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
    ([module]) => module.default
  )
  return katexPromise
}

// KaTeX, когда он нужен и уже загружен; пока грузится — null
export function useKatex(needed: boolean): Katex | null {
  const [katex, setKatex] = useState<Katex | null>(null)

  useEffect(() => {
    if (!needed || katex) return
    let cancelled = false
    loadKatex().then((k) => {
      if (!cancelled) setKatex(() => k)
    })
    return () => {
      cancelled = true
    }
  }, [needed, katex])

  return katex
}

// trust: false — никакие команды из формулы не выполняют код и не вставляют ссылки;
// throwOnError: false — ошибка в формуле показывается красным, а не ломает текст
export function renderMath(katex: Katex, tex: string, displayMode: boolean) {
  return katex.renderToString(tex, {
    displayMode,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    output: 'htmlAndMathml',
  })
}
