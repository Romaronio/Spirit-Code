// Время пробника: «3 ч 55 мин», «45 мин»
export function formatMinutes(total: number) {
  const h = Math.floor(total / 60)
  const m = total % 60
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ') || '0 мин'
}
