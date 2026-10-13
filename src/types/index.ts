export type Role = 'teacher' | 'student'

export interface User {
  name: string
  role: Role
}

export interface Account extends User {
  password: string
}

export interface LessonFile {
  id: string
  name: string
  url: string
}

export interface Account extends User {
  password: string
  subjects?: string[] // предметы, которые изучает ученик
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

