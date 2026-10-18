import type { User } from '../types'

const KEY = 'spirit-code:user'

export function saveUser(user: User) {
  try {
    localStorage.setItem(KEY, JSON.stringify(user))
  } catch {
    /* ignore */
  }
}

export function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p && typeof p.name === 'string' && (p.role === 'teacher' || p.role === 'student')) {
      return { name: p.name, role: p.role }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function clearUser() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}