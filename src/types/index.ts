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

export interface Assignment {
  id?: number
  title: string
  subject: string
  deadline: string // формат 'ГГГГ-ММ-ДД'
  recording_url?: string
  description?: string
  files?: LessonFile[]
  homework?: Homework
  created_at?: string
  updated_at?: string
}