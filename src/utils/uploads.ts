// Лимиты на файлы — копия backend/api/uploads.py. Проверяет всё равно сервер,
// здесь это нужно только чтобы сразу показать ошибку при выборе файла.
export const MAX_FILE_SIZE_MB = 10

const ALLOWED_EXTENSIONS = [
  // документы
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md',
  'ppt', 'pptx', 'odp', 'xls', 'xlsx', 'ods', 'csv',
  // изображения
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp',
  // архивы
  'zip', 'rar', '7z',
  // код
  'py', 'ipynb', 'js', 'ts', 'html', 'css', 'json', 'sql',
  'c', 'cpp', 'h', 'cs', 'java', 'kt', 'go', 'php', 'rb', 'pas', 'sh',
]

// Для атрибута accept у <input type="file">
export const ACCEPT = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',')

export interface FileEntry {
  id: string
  name: string
  file: File
}

// Несохранённые правки файлов к номерам заданий: новые файлы по номерам и id убранных
export interface TaskFilesDraft {
  added: Record<number, FileEntry[]>
  removed: Array<number | string>
}

export const EMPTY_TASK_FILES: TaskFilesDraft = { added: {}, removed: [] }

// Черновик → поля запроса (файлы убранных номеров не отправляем — сервер удалит их сам)
export function taskFileChanges(draft: TaskFilesDraft, numbers: number[]) {
  const task_files: Record<number, File[]> = {}
  for (const n of numbers) {
    if (draft.added[n]?.length) task_files[n] = draft.added[n].map((f) => f.file)
  }
  return { task_files, delete_file_ids: draft.removed }
}

function problemWith(file: File): string | null {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Файл «${file.name}»: такой тип файлов загружать нельзя`
  }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return `Файл «${file.name}» больше ${MAX_FILE_SIZE_MB} МБ`
  }
  return null
}

// Отбирает подходящие файлы из выбранных; про остальные возвращает ошибку
export function pickFiles(list: FileList | null): { entries: FileEntry[]; error: string } {
  const entries: FileEntry[] = []
  const errors: string[] = []
  for (const file of Array.from(list ?? [])) {
    const problem = problemWith(file)
    if (problem) {
      errors.push(problem)
    } else {
      entries.push({
        id: String(Date.now()) + Math.random().toString(36).slice(2),
        name: file.name,
        file,
      })
    }
  }
  return { entries, error: errors.join('. ') }
}
