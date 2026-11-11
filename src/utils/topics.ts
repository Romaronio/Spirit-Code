import type { Assignment } from '../types'

// Папки-темы уроков внутри курса: «№26», «Повторение»… Пустая тема — «Без темы».
// Папки идут по дате добавления уроков (см. groupByTopic); в списках выбора темы — по номеру, потом по алфавиту

export const NO_TOPIC = 'Без темы'

export function topicOf(lesson: Pick<Assignment, 'topic'>) {
  return (lesson.topic ?? '').trim()
}

export function topicLabel(topic: string) {
  return topic || NO_TOPIC
}

function topicKey(topic: string): [number, number, string] {
  if (!topic) return [2, 0, '']
  const number = /^№\s*(\d+)$/.exec(topic)
  return number ? [0, Number(number[1]), ''] : [1, 0, topic.toLocaleLowerCase('ru')]
}

export function compareTopics(a: string, b: string) {
  const [ga, na, sa] = topicKey(a)
  const [gb, nb, sb] = topicKey(b)
  return ga - gb || na - nb || sa.localeCompare(sb, 'ru')
}

// Уроки в теме: по месту, при равенстве — по дате создания
export function compareInTopic(a: Assignment, b: Assignment) {
  return (a.position ?? 0) - (b.position ?? 0) || (a.id ?? 0) - (b.id ?? 0)
}

export interface TopicGroup {
  topic: string
  lessons: Assignment[]
}

// Самый новый урок папки: id растёт с каждым добавленным уроком
const newestId = (lessons: Assignment[]) => Math.max(...lessons.map((a) => a.id ?? 0))

// Папки по дате добавления уроков: сверху папка, куда добавили урок последним. Внутри папки — порядок учителя
export function groupByTopic(lessons: Assignment[]): TopicGroup[] {
  const groups = new Map<string, Assignment[]>()
  for (const lesson of lessons) {
    const topic = topicOf(lesson)
    groups.set(topic, [...(groups.get(topic) ?? []), lesson])
  }
  return [...groups.entries()]
    .sort(([a, la], [b, lb]) => newestId(lb) - newestId(la) || compareTopics(a, b))
    .map(([topic, list]) => ({ topic, lessons: list.sort(compareInTopic) }))
}

// Все темы уроков — для выбора папки
export function allTopics(lessons: Assignment[]) {
  return [...new Set(lessons.map(topicOf).filter(Boolean))].sort(compareTopics)
}

// Новый порядок темы после переноса урока: во всех уроках с этой темой (по всем курсам)
// урок встаёт перед before (или в конец)
export function reorderedIds(items: Assignment[], topic: string, lessonId: number, before?: number) {
  const ids = items
    .filter((a) => topicOf(a) === topic && a.id !== lessonId)
    .sort(compareInTopic)
    .map((a) => a.id!)
  const at = before === undefined ? -1 : ids.indexOf(before)
  ids.splice(at === -1 ? ids.length : at, 0, lessonId)
  return ids
}
