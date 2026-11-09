import type { Role } from '../types'

// Учитель и куратор видят все уроки и ответы учеников и проверяют ДЗ.
// Создавать и менять уроки, управлять учениками, оплатой и созвонами может только учитель
export function canReview(role?: Role | null) {
  return role === 'teacher' || role === 'curator'
}

export const ROLE_LABELS: Record<Role, string> = {
  teacher: 'Учитель',
  curator: 'Куратор',
  student: 'Ученик',
}
