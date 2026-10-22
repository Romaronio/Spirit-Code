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
  files?: LessonFile[]
  homework?: Homework
  student_homeworks?: StudentHomework[]
  created_at?: string
  updated_at?: string
}

export type AssignmentChanges = Omit<Partial<Assignment>, 'files' | 'homework'> & {
  files?: File[]
  homework?: { description: string; files?: File[] }
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
