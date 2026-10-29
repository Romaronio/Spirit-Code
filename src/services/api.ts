import type { Account, AnswerComment, Assignment, BankTask, Call, CallJoin, NewCall, LessonFile, Homework, HomeworkFile, NewAssignment, NewBankTask, NumberedTask, Payment, TaskFileChanges, PhotoLatexResult, ReviewStatus, StudentHomework, TypingModeSummary, TypingResult, TypingStats, TypingSummary } from "../types";
import { clearSession, loadToken } from "../utils/session";

// Адрес API. По умолчанию относительный путь: и локально (через прокси Vite),
// и на сервере (через nginx) запросы идут на тот же адрес, с которого открыт сайт.
// При необходимости можно переопределить переменной VITE_API_URL в файле .env.
const API_BASE_URL: string = import.meta.env.VITE_API_URL || '/api';

// Заголовок с токеном вошедшего пользователя
function authHeaders(): Record<string, string> {
  const token = loadToken();
  return token ? { Authorization: `Token ${token}` } : {};
}

// Текст ошибки из ответа DRF: {error}, {detail} или {поле: [сообщения]}
function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const data = body as Record<string, unknown>;
    if (typeof data.error === 'string') return data.error;
    if (typeof data.detail === 'string') return data.detail;
    for (const value of Object.values(data)) {
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
  }
  return `HTTP error! status: ${status}`;
}

async function handleResponse<T>(response: Response, endpoint: string): Promise<T> {
  if (response.status === 401 && endpoint !== '/accounts/login/') {
    // Сессия истекла или токен отозван — отправляем на страницу входа
    clearSession();
    window.location.assign('/');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(errorMessage(body, response.status));
  }

  // Если ответ пустой (204 No Content), возвращаем undefined
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return response.json();
}

// Вспомогательная функция для HTTP запросов
async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...options?.headers,
    },
  });
  return handleResponse<T>(response, endpoint);
}

// Запрос с multipart/form-data (для загрузки файлов)
async function fetchAPIFormData<T>(
  endpoint: string,
  formData: FormData,
  method: 'POST' | 'PATCH' | 'PUT' = 'POST'
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: authHeaders(),
    body: formData,
  });
  return handleResponse<T>(response, endpoint);
}

// ============== ACCOUNTS API ==============

export async function getAllAccounts(): Promise<Account[]> {
  const response = await fetchAPI<{ results: Account[] }>('/accounts/');
  return response.results;
}

export async function getAccount(id: number): Promise<Account> {
  return fetchAPI<Account>(`/accounts/${id}/`);
}

export async function createAccount(account: Omit<Account, 'id'>): Promise<Account> {
  return fetchAPI<Account>('/accounts/', {
    method: 'POST',
    body: JSON.stringify(account),
  });
}

export async function updateAccount(id: number, account: Partial<Account>): Promise<Account> {
  return fetchAPI<Account>(`/accounts/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(account),
  });
}

export async function deleteAccount(id: number): Promise<void> {
  return fetchAPI<void>(`/accounts/${id}/`, {
    method: 'DELETE',
  });
}

// Учитель сбрасывает пароль ученику; сервер возвращает новый пароль один раз
export async function resetPassword(id: number): Promise<{ password: string }> {
  return fetchAPI<{ password: string }>(`/accounts/${id}/reset_password/`, { method: 'POST' });
}

export async function login(name: string, password: string): Promise<{ token: string; account: Account }> {
  return fetchAPI<{ token: string; account: Account }>('/accounts/login/', {
    method: 'POST',
    body: JSON.stringify({ name, password }),
  });
}

export async function logout(): Promise<void> {
  return fetchAPI<void>('/accounts/logout/', { method: 'POST' });
}

export async function getMe(): Promise<Account> {
  return fetchAPI<Account>('/accounts/me/');
}

// ============== ASSIGNMENTS API ==============

// Файлы к номерам: поля «<prefix>_<номер>» и JSON-список id файлов, которые учитель убрал
function appendTaskFiles(formData: FormData, prefix: string, deleteField: string, changes?: TaskFileChanges) {
  for (const [number, files] of Object.entries(changes?.task_files ?? {})) {
    files.forEach((file) => formData.append(`${prefix}_${number}`, file));
  }
  if (changes?.delete_file_ids?.length) {
    formData.append(deleteField, JSON.stringify(changes.delete_file_ids));
  }
}

// Поля ДЗ без файлов — файлы уходят отдельными полями формы
function homeworkJson(homework: { description: string; numbered_tasks?: NumberedTask[]; tasks_latex?: string }) {
  const { description, numbered_tasks, tasks_latex } = homework;
  return JSON.stringify({ description, numbered_tasks, tasks_latex });
}

export async function getAllAssignments(subject?: string): Promise<Assignment[]> {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  const response = await fetchAPI<{ results: Assignment[] }>(`/assignments/${query}`);
  return response.results;
}

export async function getAssignment(id: number): Promise<Assignment> {
  return fetchAPI<Assignment>(`/assignments/${id}/`);
}

export async function createAssignment(data: NewAssignment): Promise<Assignment> {
  const formData = new FormData();
  formData.append('title', data.title);
  formData.append('subject', data.subject);
  if (data.deadline) {
    formData.append('deadline', data.deadline);
  }
  if (data.description) {
    formData.append('description', data.description);
  }
  if (data.recording_url) {
    formData.append('recording_url', data.recording_url);
  }
  if (data.numbered_tasks?.length) {
    formData.append('numbered_tasks', JSON.stringify(data.numbered_tasks));
  }
  if (data.tasks_latex) {
    formData.append('tasks_latex', data.tasks_latex);
  }
  if (data.homework && (data.homework.description || data.homework.tasks_latex || data.homework.numbered_tasks?.length)) {
    formData.append('homework', homeworkJson(data.homework));
  }
  appendTaskFiles(formData, 'task_files', 'delete_file_ids', data);
  appendTaskFiles(formData, 'homework_task_files', 'delete_homework_file_ids', data.homework);
  if (data.files) {
    data.files.forEach((file) => formData.append('files', file));
  }
  if (data.homework_files) {
    data.homework_files.forEach((file) => formData.append('homework_files', file));
  }

  return fetchAPIFormData<Assignment>('/assignments/', formData, 'POST');
}

export async function updateAssignment(
  id: number,
  data: {
    title?: string
    subject?: string
    deadline?: string | null
    description?: string
    recording_url?: string
    numbered_tasks?: NumberedTask[]
    tasks_latex?: string
    homework?: { description: string; numbered_tasks?: NumberedTask[]; tasks_latex?: string } & TaskFileChanges
    files?: File[]
    homework_files?: File[]
  } & TaskFileChanges
): Promise<Assignment> {
  const formData = new FormData();
  if (data.title !== undefined) formData.append('title', data.title);
  if (data.subject !== undefined) formData.append('subject', data.subject);
  if (data.deadline) formData.append('deadline', data.deadline);
  if (data.description !== undefined) formData.append('description', data.description || '');
  if (data.recording_url !== undefined) formData.append('recording_url', data.recording_url || '');
  if (data.numbered_tasks !== undefined) formData.append('numbered_tasks', JSON.stringify(data.numbered_tasks));
  if (data.tasks_latex !== undefined) formData.append('tasks_latex', data.tasks_latex);
  if (data.homework) {
    formData.append('homework', homeworkJson(data.homework));
  }
  appendTaskFiles(formData, 'task_files', 'delete_file_ids', data);
  appendTaskFiles(formData, 'homework_task_files', 'delete_homework_file_ids', data.homework);
  if (data.files) {
    data.files.forEach((file) => formData.append('files', file));
  }
  if (data.homework_files) {
    data.homework_files.forEach((file) => formData.append('homework_files', file));
  }

  return fetchAPIFormData<Assignment>(`/assignments/${id}/`, formData, 'PATCH');
}

export async function deleteAssignment(id: number): Promise<void> {
  return fetchAPI<void>(`/assignments/${id}/`, {
    method: 'DELETE',
  });
}

// ============== LESSON FILES API ==============

export async function getAllLessonFiles(): Promise<LessonFile[]> {
  return fetchAPI<LessonFile[]>('/lesson-files/');
}

export async function createLessonFile(file: Omit<LessonFile, 'id'>): Promise<LessonFile> {
  return fetchAPI<LessonFile>('/lesson-files/', {
    method: 'POST',
    body: JSON.stringify(file),
  });
}

export async function deleteLessonFile(id: number): Promise<void> {
  return fetchAPI<void>(`/lesson-files/${id}/`, {
    method: 'DELETE',
  });
}

// ============== HOMEWORK API ==============

export async function getAllHomeworks(): Promise<Homework[]> {
  const response = await fetchAPI<{ results: Homework[] }>('/homeworks/');
  return response.results;
}

export async function getHomework(id: number): Promise<Homework> {
  return fetchAPI<Homework>(`/homeworks/${id}/`);
}

export async function createHomework(homework: Omit<Homework, 'id'>): Promise<Homework> {
  return fetchAPI<Homework>('/homeworks/', {
    method: 'POST',
    body: JSON.stringify(homework),
  });
}

export async function updateHomework(id: number, homework: Partial<Homework>): Promise<Homework> {
  return fetchAPI<Homework>(`/homeworks/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(homework),
  });
}

export async function deleteHomework(id: number): Promise<void> {
  return fetchAPI<void>(`/homeworks/${id}/`, {
    method: 'DELETE',
  });
}

// ============== HOMEWORK FILES API ==============

export async function createHomeworkFile(file: Omit<HomeworkFile, 'id'>): Promise<HomeworkFile> {
  return fetchAPI<HomeworkFile>('/homework-files/', {
    method: 'POST',
    body: JSON.stringify(file),
  });
}

export async function deleteHomeworkFile(id: number): Promise<void> {
  return fetchAPI<void>(`/homework-files/${id}/`, {
    method: 'DELETE',
  });
}

// ============== STUDENT HOMEWORK API ==============

export async function submitStudentHomework(data: {
  assignmentId: number
  description: string
  files?: File[]
  deleteFileIds?: Array<number | string>
}): Promise<StudentHomework> {
  const formData = new FormData();
  formData.append('description', data.description);
  if (data.deleteFileIds) {
    formData.append('delete_file_ids', JSON.stringify(data.deleteFileIds));
  }
  if (data.files) {
    data.files.forEach((file) => formData.append('files', file));
  }

  return fetchAPIFormData<StudentHomework>(
    `/assignments/${data.assignmentId}/submit/`,
    formData,
    'POST'
  );
}

// Отметка учителя: сдано / не сдано / снять отметку
export async function reviewStudentHomework(id: number, status: ReviewStatus): Promise<StudentHomework> {
  return fetchAPI<StudentHomework>(`/student-homeworks/${id}/review/`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

// Сообщение в переписке по ответу (пишет учитель или сам ученик)
export async function addComment(answerId: number, text: string): Promise<AnswerComment> {
  return fetchAPI<AnswerComment>(`/student-homeworks/${answerId}/comments/`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export async function editComment(commentId: number, text: string): Promise<AnswerComment> {
  return fetchAPI<AnswerComment>(`/answer-comments/${commentId}/`, {
    method: 'PATCH',
    body: JSON.stringify({ text }),
  });
}

export async function deleteComment(commentId: number): Promise<void> {
  return fetchAPI<void>(`/answer-comments/${commentId}/`, { method: 'DELETE' });
}

export async function getAllStudentHomeworks(): Promise<StudentHomework[]> {
  const response = await fetchAPI<{ results: StudentHomework[] }>('/student-homeworks/');
  return response.results;
}

// ============== PAYMENTS API ==============

// Отметки оплаты за учебный год: startYear=2026 → сентябрь 2026 — август 2027
export async function getPayments(startYear: number): Promise<Payment[]> {
  return fetchAPI<Payment[]>(`/payments/?school_year=${startYear}`);
}

export async function setPayment(payment: Payment, paid: boolean): Promise<Payment & { paid: boolean }> {
  return fetchAPI<Payment & { paid: boolean }>('/payments/set/', {
    method: 'POST',
    body: JSON.stringify({ ...payment, paid }),
  });
}

// ============== TYPING TRAINER API ==============

// Ученик сохраняет результат теста; сервер сам считает скорость и точность
export async function saveTypingResult(stats: TypingStats): Promise<TypingResult> {
  return fetchAPI<TypingResult>('/typing-results/', {
    method: 'POST',
    body: JSON.stringify(stats),
  });
}

// Ученику — свои результаты, учителю — результаты выбранного ученика
export async function getTypingResults(studentId?: number): Promise<TypingResult[]> {
  const query = studentId ? `?student=${studentId}` : '';
  const response = await fetchAPI<{ results: TypingResult[] }>(`/typing-results/${query}`);
  return response.results;
}

export async function getTypingSummary(): Promise<TypingSummary[]> {
  return fetchAPI<TypingSummary[]>('/typing-results/summary/');
}

// Учитель: статистика ученика по каждому из режимов тренажёра
export async function getTypingByMode(studentId: number): Promise<TypingModeSummary[]> {
  return fetchAPI<TypingModeSummary[]>(`/typing-results/by-mode/?student=${studentId}`);
}

// ============== ФОТО → LATEX ==============

// Учитель: фото задания → LaTeX в стиле Spirit Code (Tesseract + GigaChat на сервере)
export async function photoToLatex(image: File, number: number): Promise<PhotoLatexResult> {
  const formData = new FormData();
  formData.append('image', image);
  formData.append('number', String(number));
  return fetchAPIFormData<PhotoLatexResult>('/photo-latex/', formData, 'POST');
}

// ============== БАЗА ЗАДАНИЙ ЕГЭ ==============

export async function getBankTasks(): Promise<BankTask[]> {
  return fetchAPI<BankTask[]>('/bank-tasks/');
}

export async function createBankTask(task: NewBankTask): Promise<BankTask> {
  return fetchAPI<BankTask>('/bank-tasks/', {
    method: 'POST',
    body: JSON.stringify(task),
  });
}

export async function deleteBankTask(id: number): Promise<void> {
  return fetchAPI<void>(`/bank-tasks/${id}/`, {
    method: 'DELETE',
  });
}

// ============== CALLS API (созвоны LiveKit) ==============

export async function getCalls(): Promise<Call[]> {
  return fetchAPI<Call[]>('/calls/');
}

export async function startCall(call: NewCall): Promise<Call> {
  return fetchAPI<Call>('/calls/', {
    method: 'POST',
    body: JSON.stringify(call),
  });
}

export async function joinCall(id: number): Promise<CallJoin> {
  return fetchAPI<CallJoin>(`/calls/${id}/join/`, { method: 'POST' });
}

export async function endCall(id: number): Promise<void> {
  return fetchAPI<void>(`/calls/${id}/end/`, { method: 'POST' });
}
