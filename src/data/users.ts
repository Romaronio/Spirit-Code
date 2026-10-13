import type { Account } from '../types'

// Учебные аккаунты. В настоящем приложении такие данные лежат на сервере,
// а пароли хранятся в виде хэшей.
export const accounts: Account[] = [
  { name: 'Анна', password: 'anna123', role: 'student' },
  { name: 'Иван', password: 'ivan123', role: 'student' },
  { name: 'roman', password: '12345', role: 'teacher' },
]