import type { Account, Assignment, LessonFile, Homework, HomeworkFile, Payment, ReviewStatus, StudentHomework } from "../types";
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

export async function getAllAssignments(subject?: string): Promise<Assignment[]> {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  const response = await fetchAPI<{ results: Assignment[] }>(`/assignments/${query}`);
  return response.results;
}

export async function getAssignment(id: number): Promise<Assignment> {
  return fetchAPI<Assignment>(`/assignments/${id}/`);
}

export async function createAssignment(data: {
  title: string
  subject: string
  deadline: string
  description?: string
  recording_url?: string
  homework?: { description: string }
  files?: File[]
  homework_files?: File[]
}): Promise<Assignment> {
  const formData = new FormData();
  formData.append('title', data.title);
  formData.append('subject', data.subject);
  formData.append('deadline', data.deadline);
  if (data.description) {
    formData.append('description', data.description);
  }
  if (data.recording_url) {
    formData.append('recording_url', data.recording_url);
  }
  if (data.homework && data.homework.description) {
    formData.append('homework', JSON.stringify(data.homework));
  }
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
    deadline?: string
    description?: string
    recording_url?: string
    homework?: { description: string }
    files?: File[]
    homework_files?: File[]
  }
): Promise<Assignment> {
  const formData = new FormData();
  if (data.title !== undefined) formData.append('title', data.title);
  if (data.subject !== undefined) formData.append('subject', data.subject);
  if (data.deadline !== undefined) formData.append('deadline', data.deadline);
  if (data.description !== undefined) formData.append('description', data.description || '');
  if (data.recording_url !== undefined) formData.append('recording_url', data.recording_url || '');
  if (data.homework) {
    formData.append('homework', JSON.stringify(data.homework));
  }
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
