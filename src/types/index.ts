export type Role = 'teacher' | 'student'

export interface User {
  name: string
  role: Role
}

export interface LessonFile {
  id: string
  name: string
  url: string
}

export interface Assignment {
  id: string
  title: string
  subject: string
  deadline: string // формат 'ГГГГ-ММ-ДД'
  recordingUrl?: string
  description?: string
  files?: LessonFile[]
}
