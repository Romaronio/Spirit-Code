export type Role = 'teacher' | 'curator' | 'student' // куратор проверяет ДЗ, но не меняет уроки

export interface User {
  id?: number
  name: string
  role: Role
}

export interface Account extends User {
  id?: number
  password: string
  subjects?: string[] // предметы, которые изучает ученик
  is_owner?: boolean // создатель платформы: только он добавляет учителей и кураторов
  students?: number[] // у куратора — закреплённые за ним ученики (видит и проверяет только их)
  created_at?: string
  updated_at?: string
}

export interface LessonFile {
  id?: number | string
  name: string
  url: string
  task_number?: number | null // файл к номеру задания; null — общий файл урока
  created_at?: string
}

export interface HomeworkFile {
  id?: number | string
  name: string
  url: string
  task_number?: number | null // файл к номеру задания ДЗ; null — общий файл ДЗ
  created_at?: string
}

export interface Homework {
  id?: number
  assignment?: number
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
  task_key?: string // файл к ответу на задание; '' — общий файл ответа
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
  // Ответы к отдельным заданиям: 'cw-5' — номер классной работы, 'hw-5' — номер ДЗ,
  // 'classwork' / 'homework' — задания без номера
  task_answers?: Record<string, string>
  task_checks?: Record<string, boolean> // автопроверка кратких ответов: true — верно (учителю — всегда, ученику — после отправки)
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
  extra_subjects?: string[] // ещё предметы, в которых есть этот же урок (не копия)
  deadline?: string | null // формат 'ГГГГ-ММ-ДД', может быть не задан
  lesson_date?: string | null // день занятия 'ГГГГ-ММ-ДД' — по нему урок в календаре
  recording_url?: string
  numbered_tasks?: NumberedTask[] // задания по номерам — у каждого своя кнопка
  tasks_latex?: string // задания классной работы в LaTeX без номера
  files?: LessonFile[]
  homework?: Homework
  student_homeworks?: StudentHomework[]
  figures?: TikzFigure[] // рисунки TikZ из заданий, их собирает сервер
  topic?: string // папка-тема внутри курса: «№26», «Повторение»; '' — без темы
  position?: number // место в теме, меньше — выше
  created_at?: string
  updated_at?: string
}

export interface TikzFigure {
  source: string // текст рисунка: по нему документ находит свой рисунок
  status: 'pending' | 'ok' | 'error'
  url?: string
  error?: string // почему не собрался, приходит только учителю
}

// Задание с номером (например, номер задания ЕГЭ) и его текст в LaTeX
export interface NumberedTask {
  number: number
  latex: string
  answer?: string // видит только учитель: сервер не отдаёт его ученикам
  short_only?: boolean // ученик присылает только краткий ответ — без программы и файлов
  detailed_required?: boolean // без программы или файла к номеру ученик не отправит ДЗ
}

// Файлы к номерам заданий для отправки: новые по номерам и id убранных сохранённых
export interface TaskFileChanges {
  task_files?: Record<number, File[]>
  delete_file_ids?: Array<number | string>
}

// Данные формы «Новое задание»
export type NewAssignment = {
  title: string
  subject: string
  deadline?: string
  lesson_date?: string
  recording_url?: string
  numbered_tasks?: NumberedTask[]
  tasks_latex?: string
  homework?: { numbered_tasks?: NumberedTask[]; tasks_latex?: string } & TaskFileChanges
  files?: File[]
  homework_files?: File[]
} & TaskFileChanges

export type AssignmentChanges = Omit<Partial<Assignment>, 'files' | 'homework'> & TaskFileChanges & {
  files?: File[]
  homework?: { numbered_tasks?: NumberedTask[]; tasks_latex?: string; files?: File[] } & TaskFileChanges
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

// Созвон-урок (LiveKit)
// Предмет в списках выбора (форма урока, предметы ученика, созвоны)
export interface Subject {
  id: number
  name: string
  created_by?: number | null // учитель, который создал предмет
}

export interface Call {
  id: number
  title: string
  subject: string // пусто — для всех учеников
  extra_subjects: string[] // ещё предметы: созвон сразу для их учеников
  student: number | null // личный урок с одним учеником
  student_name: string | null
  assignment: number | null // урок, задания которого открыты в созвоне
  assignment_title: string | null
  shown_task: string // задание, которое учитель показал ученикам ('cw-5', 'hw-3', …); '' — ничего
  started_by_name: string
  started_at: string
  ended_at: string | null
}

// Ответ ученика к заданию на уроке в созвоне — хранится отдельно от ДЗ и проверки не ждёт
export interface CallAnswer {
  id: number
  assignment: number
  student: number
  student_name: string
  task: string
  text: string
  files: Array<{ id: number; name: string; url: string | null }>
  updated_at: string
}

export type NewCall = Pick<Call, 'title' | 'subject' | 'extra_subjects' | 'student' | 'assignment'>

// Пропуск в комнату: токен LiveKit и адрес сервера (пусто — этот же сайт, путь /livekit)
export interface CallJoin {
  call: Call
  token: string
  url: string
}
