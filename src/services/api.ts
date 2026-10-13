import type { Account, Assignment, LessonFile } from "../types";

const API_BASE_URL = 'http://localhost:8000/api';

// Вспомогательная функция для HTTP запросов
async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP error! status: ${response.status}`);
  }

  // Если ответ пустой (204 No Content), возвращаем undefined
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return response.json();
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

export async function login(name: string, password: string): Promise<Account> {
  return fetchAPI<Account>('/accounts/login/', {
    method: 'POST',
    body: JSON.stringify({ name, password }),
  });
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

export async function createAssignment(assignment: Omit<Assignment, 'id'>): Promise<Assignment> {
  return fetchAPI<Assignment>('/assignments/', {
    method: 'POST',
    body: JSON.stringify(assignment),
  });
}

export async function updateAssignment(id: number, assignment: Partial<Assignment>): Promise<Assignment> {
  return fetchAPI<Assignment>(`/assignments/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(assignment),
  });
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