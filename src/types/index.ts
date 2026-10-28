export type Role = 'teacher' | 'student'

export interface User {
  id?: number
  name: string
  role: Role
}

export interface Account extends User {
  id?: number
  password: string
  subjects?: string[] // предметы, которые изучает ученик
  created_at?: string
  updated_at?: string
}

export interface LessonFile {
  id?: number | string
  name: string
  url: string
  created_at?: string
}

export interface HomeworkFile {
  id?: number | string
  name: string
  url: string
  created_at?: string
}

export interface Homework {
  id?: number
  assignment?: number
  description: string
  numbered_tasks?: NumberedTask[] // задания ДЗ по номерам — у каждого своя кнопка
  tasks_latex?: string // задания в LaTeX, открываются прямо на сайте
  files?: HomeworkFile[]
  created_at?: string
  updated_at?: string
}

export interface StudentHomeworkFile {
  id?: number | string
  name: string
  url?: string
  created_at?: string
}

export type ReviewStatus = 'pending' | 'accepted' | 'rejected'

// Сообщение в переписке по ответу ученика
export interface AnswerComment {
  id: number
  author: number
  author_name: string
  author_role: Role
  text: string
  created_at: string
  edited_at?: string | null
}

export interface StudentHomework {
  id?: number
  assignment?: number
  student?: number
  student_name?: string
  description: string
  files?: StudentHomeworkFile[]
  submitted_at?: string
  status?: ReviewStatus // отметка учителя после проверки
  checked_at?: string | null
  comments?: AnswerComment[]
}

export interface Assignment {
  id?: number
  title: string
  subject: string
  deadline: string // формат 'ГГГГ-ММ-ДД'
  recording_url?: string
  description?: string
  numbered_tasks?: NumberedTask[] // задания по номерам — у каждого своя кнопка
  tasks_latex?: string // задания классной работы в LaTeX без номера
  files?: LessonFile[]
  homework?: Homework
  student_homeworks?: StudentHomework[]
  created_at?: string
  updated_at?: string
}

// Задание с номером (например, номер задания ЕГЭ) и его текст в LaTeX
export interface NumberedTask {
  number: number
  latex: string
}

// Данные формы «Новое задание»
export interface NewAssignment {
  title: string
  subject: string
  deadline: string
  description?: string
  recording_url?: string
  numbered_tasks?: NumberedTask[]
  tasks_latex?: string
  homework?: { description: string; numbered_tasks?: NumberedTask[]; tasks_latex?: string }
  files?: File[]
  homework_files?: File[]
}

export type AssignmentChanges = Omit<Partial<Assignment>, 'files' | 'homework'> & {
  files?: File[]
  homework?: { description: string; numbered_tasks?: NumberedTask[]; tasks_latex?: string; files?: File[] }
}

// Действия с перепиской по ответу (реализованы в App.tsx)
export interface CommentActions {
  add: (assignmentId: number, answerId: number, text: string) => Promise<void>
  edit: (assignmentId: number, answerId: number, commentId: number, text: string) => Promise<void>
  remove: (assignmentId: number, answerId: number, commentId: number) => Promise<void>
}

// Отметка «ученик оплатил занятия за месяц»
export interface Payment {
  student: number
  year: number
  month: number // 1–12
}

// ege — слова из Python для ЕГЭ по информатике, ege_hard — целые строки кода
export type TypingLanguage = 'ru' | 'en' | 'ege' | 'ege_hard'

// Сырые счётчики теста печати: скорость и точность считает сервер
export interface TypingStats {
  language: TypingLanguage
  duration: number // секунды
  correct_words: number
  correct_chars: number
  keystrokes: number
  errors: number // слов, отправленных пробелом с ошибкой
}

export interface TypingResult extends TypingStats {
  id: number
  student: number
  student_name: string
  wpm: number // слов в минуту
  cpm: number // знаков в минуту
  accuracy: number // %
  created_at: string
}

// Лучший / последний / средний результат (null — попыток ещё не было)
export interface TypingStatsSummary {
  tests: number
  best_wpm: number | null
  last_wpm: number | null
  avg_wpm: number | null
  avg_accuracy: number | null
  last_at: string | null
}

// Строка сводки учителя по одному ученику
export interface TypingSummary extends TypingStatsSummary {
  student: number
  student_name: string
}

// Статистика ученика в одном режиме тренажёра
export interface TypingModeSummary extends TypingStatsSummary {
  language: TypingLanguage
}

// Ответ распознавания фото задания (POST /api/photo-latex/)
export interface PhotoLatexResult {
  latex: string
  ocr_text: string // текст, который прочитал Tesseract — для сверки
  warnings: string[]
}
