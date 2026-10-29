import { useMemo } from 'react'
import styles from './LatexDocument.module.css'
import { imageKey, parseLatex, type Block, type Inline, type ListKind } from '../../utils/latex'
import { renderMath, useKatex, type Katex } from '../../utils/katex'

export interface DocFile {
  name: string
  url?: string
}

interface Props {
  source: string
  files?: DocFile[] // картинки для \includegraphics ищутся среди прикреплённых файлов
}

// Задания, написанные в LaTeX, в виде обычной страницы
function LatexDocument({ source, files = [] }: Props) {
  const doc = useMemo(() => parseLatex(source), [source])
  const katex = useKatex(useMemo(() => hasMath(doc.blocks), [doc]))
  const images = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of files) if (f.url) map.set(imageKey(f.name), f.url)
    return map
  }, [files])

  const ctx: Ctx = { katex, images }
  return <div className={styles.doc}>{renderBlocks(doc.blocks, ctx)}</div>
}

interface Ctx {
  katex: Katex | null
  images: Map<string, string>
}

const LIST_TYPES: Record<Exclude<ListKind, 'ul' | 'desc'>, '1' | 'a' | 'A' | 'i' | 'I'> = {
  '1': '1', a: 'a', A: 'A', i: 'i', I: 'I',
}

function renderBlocks(blocks: Block[], ctx: Ctx) {
  return blocks.map((b, i) => renderBlock(b, i, ctx))
}

function renderBlock(b: Block, key: number, ctx: Ctx): React.ReactNode {
  switch (b.t) {
    case 'p':
      return <p key={key} className={styles.p}>{renderInlines(b.c, ctx)}</p>
    case 'task':
      return (
        <div key={key} className={styles.task}>
          <span className={styles.taskBadge}>{b.title}</span>
          <span className={styles.taskLine} />
        </div>
      )
    case 'hr':
      return <hr key={key} className={styles.hr} />
    case 'h': {
      const Tag = (['h2', 'h3', 'h4'] as const)[b.level - 1]
      return <Tag key={key} className={styles.heading}>{renderInlines(b.c, ctx)}</Tag>
    }
    case 'list': {
      const items = b.items.map((item, i) => <li key={i}>{renderBlocks(item, ctx)}</li>)
      if (b.kind === 'ul') return <ul key={key} className={styles.list}>{items}</ul>
      if (b.kind === 'desc') return <ul key={key} className={`${styles.list} ${styles.plainList}`}>{items}</ul>
      return (
        <ol key={key} className={styles.list} type={LIST_TYPES[b.kind]} start={b.start}>
          {items}
        </ol>
      )
    }
    case 'math':
      return <Formula key={key} tex={b.v} display katex={ctx.katex} />
    case 'code':
      return <pre key={key} className={styles.code}><code>{b.v}</code></pre>
    case 'img': {
      const url = ctx.images.get(imageKey(b.name))
      if (!url) {
        return (
          <p key={key} className={styles.missing}>
            Рисунок «{b.name}» — прикрепите к заданию файл с таким именем
          </p>
        )
      }
      return (
        <img
          key={key}
          className={styles.img}
          src={url}
          alt={b.name}
          style={b.width ? { width: b.width } : undefined}
        />
      )
    }
    case 'table':
      return (
        <div key={key} className={styles.tableWrap}>
          <table className={styles.table}>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => <td key={c}>{renderInlines(cell, ctx)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'align':
      return <div key={key} className={styles[b.align]}>{renderBlocks(b.c, ctx)}</div>
    case 'quote':
      return <blockquote key={key} className={styles.quote}>{renderBlocks(b.c, ctx)}</blockquote>
    case 'frame':
      return <div key={key} className={styles.frame}>{renderBlocks(b.c, ctx)}</div>
    case 'figure':
      return <p key={key} className={styles.missing}>Здесь рисунок TikZ — на сайте его не показать, вставьте его картинкой</p>
  }
}

function renderInlines(items: Inline[], ctx: Ctx): React.ReactNode[] {
  return items.map((it, i) => renderInline(it, i, ctx))
}

// Названия цветов; vekorange — фирменный оранжевый
function cssColor(color: string): string | undefined {
  if (color === 'vekorange') return '#ff8400'
  // На тёмной теме чёрный текст не виден — оставляем обычный цвет текста
  if (color === 'black') return undefined
  if (/^[a-zA-Z]+$/.test(color)) return color
  return undefined
}

function safeHref(href: string): string | undefined {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : undefined
}

function renderInline(it: Inline, key: number, ctx: Ctx): React.ReactNode {
  switch (it.t) {
    case 'text':
      return it.v
    case 'br':
      return <br key={key} />
    case 'b':
      return <strong key={key}>{renderInlines(it.c, ctx)}</strong>
    case 'i':
      return <em key={key}>{renderInlines(it.c, ctx)}</em>
    case 'u':
      return <u key={key}>{renderInlines(it.c, ctx)}</u>
    case 'tt':
      return <code key={key} className={styles.tt}>{renderInlines(it.c, ctx)}</code>
    case 'sc':
      return <span key={key} className={styles.sc}>{renderInlines(it.c, ctx)}</span>
    case 'small':
      return <small key={key}>{renderInlines(it.c, ctx)}</small>
    case 'box':
      return <span key={key} className={styles.box}>{renderInlines(it.c, ctx)}</span>
    case 'color':
      return <span key={key} style={{ color: cssColor(it.color) }}>{renderInlines(it.c, ctx)}</span>
    case 'code':
      return <code key={key} className={styles.tt}>{it.v}</code>
    case 'math':
      return <Formula key={key} tex={it.v} katex={ctx.katex} />
    case 'link': {
      const href = safeHref(it.href)
      const content = renderInlines(it.c, ctx)
      return href
        ? <a key={key} href={href} target="_blank" rel="noreferrer">{content}</a>
        : <span key={key}>{content}</span>
    }
  }
}

// Пока KaTeX грузится — формула показывается как есть
function Formula({ tex, display = false, katex }: { tex: string; display?: boolean; katex: Katex | null }) {
  if (!katex) return <code className={styles.raw}>{display ? `\\[${tex}\\]` : `$${tex}$`}</code>
  return (
    <span
      className={display ? styles.displayMath : styles.inlineMath}
      dangerouslySetInnerHTML={{ __html: renderMath(katex, tex, display) }}
    />
  )
}

function hasMath(blocks: Block[]): boolean {
  const inl = (items: Inline[]): boolean => items.some((it) => it.t === 'math' || ('c' in it && inl(it.c)))
  return blocks.some((b) => {
    if (b.t === 'math') return true
    if (b.t === 'p' || b.t === 'h') return inl(b.c)
    if (b.t === 'list') return b.items.some(hasMath)
    if (b.t === 'table') return b.rows.some((row) => row.some(inl))
    if (b.t === 'align' || b.t === 'quote' || b.t === 'frame') return hasMath(b.c)
    return false
  })
}

export default LatexDocument
