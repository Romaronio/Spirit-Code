import type { Account, Assignment, StudentHomework } from '../types'
import { lessonForSubjects } from './subjects'

// Урок ученика и его ответ (undefined — ещё не отправлял)
export interface StudentLesson {
  lesson: Assignment
  answer?: StudentHomework
}

export interface StudentStats {
  lessons: StudentLesson[] // уроки по предметам ученика, новые сверху
  total: number
  accepted: number // учитель отметил «Сдано»
  pending: number // ждут проверки
  rejected: number // «Не сдано» — нужно исправить
  notSent: number // ещё ничего не отправил
  taskAnswers: number // ответов к отдельным заданиям
  lastActivity: string | null // последний ответ или сообщение учителю
}

// Сколько заданий урока ученик решил: ответы текстом и задания с файлами
export function taskAnswerCount(answer?: StudentHomework) {
  if (!answer) return 0
  const keys = new Set(Object.keys(answer.task_answers ?? {}).filter((k) => answer.task_answers?.[k]?.trim()))
  for (const f of answer.files ?? []) if (f.task_key) keys.add(f.task_key)
  return keys.size
}

// Ключи классной работы: 'cw-5' — номер, 'classwork' — задания без номера
const isClassworkKey = (key: string) => key === 'classwork' || key.startsWith('cw-')

// В ответе только классная работа: ни ДЗ, ни описания, ни общих файлов к уроку.
// Классную работу можно не решать, поэтому учителю такой ответ проверять не нужно
export function isClassworkOnly(answer: StudentHomework) {
  if (answer.description?.trim()) return false
  const answers = answer.task_answers ?? {}
  if (Object.keys(answers).some((k) => answers[k]?.trim() && !isClassworkKey(k))) return false
  return !(answer.files ?? []).some((f) => !f.task_key || !isClassworkKey(f.task_key))
}

// Ответ ждёт проверки учителя: отметки ещё нет и в нём есть что-то кроме классной работы
export function awaitsReview(answer: StudentHomework) {
  return (answer.status ?? 'pending') === 'pending' && !isClassworkOnly(answer)
}

// Статистика ученика по урокам — считается из уже загруженных уроков (учитель видит все ответы)
export function studentStats(student: Account, items: Assignment[]): StudentStats {
  const lessons = items
    .filter((a) => lessonForSubjects(student.subjects, a))
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
    .map((lesson) => ({ lesson, answer: lesson.student_homeworks?.find((sh) => sh.student === student.id) }))

  const stats: StudentStats = {
    lessons,
    total: lessons.length,
    accepted: 0,
    pending: 0,
    rejected: 0,
    notSent: 0,
    taskAnswers: 0,
    lastActivity: null,
  }
  const dates: string[] = []
  for (const { answer } of lessons) {
    if (!answer) {
      stats.notSent++
      continue
    }
    const status = answer.status ?? 'pending'
    if (status !== 'pending' || awaitsReview(answer)) stats[status]++
    stats.taskAnswers += taskAnswerCount(answer)
    if (answer.submitted_at) dates.push(answer.submitted_at)
    for (const c of answer.comments ?? []) if (c.author === student.id) dates.push(c.created_at)
  }
  stats.lastActivity = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
  return stats
}

// «сегодня в 14:05», «вчера в 9:30» или «12.10.2026»
export function formatActivity(iso: string | null) {
  if (!iso) return 'ещё не отвечал'
  const date = new Date(iso)
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return `сегодня в ${time}`
  if (date.toDateString() === yesterday.toDateString()) return `вчера в ${time}`
  return date.toLocaleDateString('ru-RU')
}

// Номера, где отправленный краткий ответ неверен или учитель отметил задание неверным
// (есть, пока ученик не отправит верный ответ). Порядок — как у уроков
export function mistakesOf(items: Assignment[]) {
  return items.flatMap((lesson) => (lesson.student_homeworks?.[0]?.wrong_tasks ?? []).map((key) => ({ lesson, key })))
}
