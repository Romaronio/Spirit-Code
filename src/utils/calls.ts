import type { Call } from '../types'

// «Биология · Разбор 27» или «все ученики», если предмет не выбран
export function callName(call: Call) {
  return [call.student_name ? `лично с ${call.student_name}` : call.subject || 'все ученики', call.title].filter(Boolean).join(' · ')
}
