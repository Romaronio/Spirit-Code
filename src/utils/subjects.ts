// Сравниваем предметы без учёта регистра и лишних пробелов
export function normalize(value: string) {
  return value.trim().toLowerCase()
}

export function hasSubject(subjects: string[] | undefined, subject: string) {
  return (subjects ?? []).some((s) => normalize(s) === normalize(subject))
}

// Все предметы урока: основной и дополнительные (урок может быть сразу в нескольких)
export function lessonSubjects(lesson: { subject: string; extra_subjects?: string[] }) {
  return [lesson.subject, ...(lesson.extra_subjects ?? [])]
}

// Виден ли урок ученику с такими предметами — по любому из предметов урока
export function lessonForSubjects(subjects: string[] | undefined, lesson: { subject: string; extra_subjects?: string[] }) {
  return lessonSubjects(lesson).some((s) => hasSubject(subjects, s))
}

export function toggleSubject(subjects: string[], subject: string) {
  return hasSubject(subjects, subject)
    ? subjects.filter((s) => normalize(s) !== normalize(subject))
    : [...subjects, subject]
}

// Уникальные значения без учёта регистра, по алфавиту
export function uniqueSubjects(list: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of list) {
    const key = normalize(item)
    if (key !== '' && !seen.has(key)) {
      seen.add(key)
      result.push(item.trim())
    }
  }
  return result.sort((a, b) => a.localeCompare(b, 'ru'))
}
