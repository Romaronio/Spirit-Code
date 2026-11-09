import type { Assignment, NumberedTask, StudentHomework } from '../types'
import type { DocFile } from '../components/LatexDocument/LatexDocument'
import { taskNumberTitle } from './taskNumbers'

// Задания урока в одном списке — для панели заданий в созвоне.
// key — как в StudentHomework.task_answers: 'cw-5' (класс), 'hw-5' (дз), 'classwork' / 'homework' (без номера)
export interface LessonTask {
  key: string
  title: string // «5 задание» или «Другие задания»
  group: 'класс' | 'дз'
  source: string // LaTeX
  number?: number // номер задания — им подписаны плашки
  answer?: string // верный ответ, приходит только учителю
  shortOnly?: boolean // только краткий ответ — без программы и файлов
  detailedRequired?: boolean // развёрнутый ответ обязателен
  files: DocFile[] // картинки для документа
  attachments: DocFile[] // файлы для выполнения этого номера
}

type FileWithTask = DocFile & { task_number?: number | null }

// Номер виден ученику, если у него есть LaTeX или файлы для выполнения
function isShown(t: NumberedTask, files: FileWithTask[]) {
  return t.latex.trim() !== '' || files.some((f) => f.task_number === t.number)
}

export function lessonTasks(assignment: Assignment): LessonTask[] {
  const result: LessonTask[] = []
  const add = (prefix: 'cw' | 'hw', group: LessonTask['group'], tasks: NumberedTask[], latex: string, files: FileWithTask[], other: string) => {
    const numbered = tasks.filter((t) => isShown(t, files))
    for (const t of numbered) {
      result.push({
        key: `${prefix}-${t.number}`,
        title: taskNumberTitle(t.number),
        group,
        source: t.latex,
        number: t.number,
        answer: t.answer,
        shortOnly: t.short_only,
        detailedRequired: t.detailed_required,
        files,
        attachments: files.filter((f) => f.task_number === t.number),
      })
    }
    if (latex.trim()) {
      result.push({
        key: prefix === 'cw' ? 'classwork' : 'homework',
        title: numbered.length ? 'Другие задания' : other,
        group,
        source: latex,
        files,
        attachments: [],
      })
    }
  }
  add('cw', 'класс', assignment.numbered_tasks ?? [], assignment.tasks_latex ?? '', assignment.files ?? [], 'Задания')
  const hw = assignment.homework
  if (hw) add('hw', 'дз', hw.numbered_tasks ?? [], hw.tasks_latex ?? '', hw.files ?? [], 'Домашнее задание')
  return result
}

// Подпись задания в ответах учеников у учителя
export function answerKeyTitle(key: string): string {
  const m = /^(cw|hw)-(\d+)$/.exec(key)
  if (m) return `${taskNumberTitle(Number(m[2]))} (${m[1] === 'cw' ? 'класс' : 'дз'})`
  return key === 'homework' ? 'Задания дз' : 'Задания класс'
}

// Есть ли у ученика ответ к заданию: текст или файлы
export function hasTaskAnswer(sh: StudentHomework | undefined, key: string) {
  return Boolean(sh?.task_answers?.[key]?.trim() || sh?.files?.some((f) => f.task_key === key))
}

// Ответ к заданию хранится одной строкой: короткий ответ, а программа — блоком ``` в конце.
// Старые ответы без блока — просто текст ответа
const CODE_BLOCK_RE = /^([\s\S]*?)\n?```\n([\s\S]*)\n```$/

export interface TaskAnswerParts {
  answer: string
  code: string
}

export function splitTaskAnswer(text: string | undefined): TaskAnswerParts {
  // При отправке через FormData браузер меняет переводы строк на \r\n — приводим обратно
  const value = (text ?? '').replace(/\r\n?/g, '\n')
  const m = CODE_BLOCK_RE.exec(value)
  return m ? { answer: m[1], code: m[2] } : { answer: value, code: '' }
}

export function joinTaskAnswer({ answer, code }: TaskAnswerParts): string {
  const a = answer.trim()
  return code.trim() ? `${a}${a ? '\n' : ''}\`\`\`\n${code.replace(/\s+$/, '')}\n\`\`\`` : a
}

// Развёрнутый ответ к заданию: программа или файл к этому заданию
export function hasDetailedAnswer(sh: StudentHomework | undefined, key: string) {
  return Boolean(splitTaskAnswer(sh?.task_answers?.[key]).code.trim() || sh?.files?.some((f) => f.task_key === key))
}
