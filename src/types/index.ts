export type Role = 'teacher' | 'student'

export interface User {
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
  id?: number
  name: string
  url: string
  created_at?: string
}

export interface Assignment {
  id?: number
  title: string
  subject: string
  deadline: string // формат 'ГГГГ-ММ-ДД'
  recording_url?: string
  description?: string
  files?: LessonFile[]
  created_at?: string
  updated_at?: string
}