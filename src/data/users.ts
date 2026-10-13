import type { Account } from '../types'

// Учебные аккаунты. В настоящем приложении такие данные лежат на сервере,
// а пароли хранятся в виде хэшей.
export const accounts: Account[] = [
  { name: 'Anna', password: 'anna', role: 'student', subjects: ['Биология', 'Геометрия'] },
  { name: 'Иван', password: 'ivan123', role: 'student', subjects: ['Английский'] },
  { name: 'Мария Петровна', password: 'teacher123', role: 'teacher' },
]