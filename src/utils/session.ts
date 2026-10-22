import type { User } from '../types'

const KEY = 'spirit-code:session'
const LEGACY_KEY = 'spirit-code:user' // старый формат без токена

interface Session {
  token: string
  user: User
}

export function saveSession(token: string, user: User) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, user }))
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* ignore */
  }
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    const u = p?.user
    if (
      typeof p?.token === 'string' &&
      u && typeof u.name === 'string' &&
      (u.role === 'teacher' || u.role === 'student')
    ) {
      return { token: p.token, user: { id: u.id, name: u.name, role: u.role } }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function loadUser(): User | null {
  return loadSession()?.user ?? null
}

export function loadToken(): string | null {
  return loadSession()?.token ?? null
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* ignore */
  }
}
