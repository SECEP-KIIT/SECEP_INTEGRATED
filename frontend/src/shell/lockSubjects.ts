const MAX_SUBJECTS = 3

/** Unread Critical subjects, duplicates merged, capped at three; `more` counts the distinct ones left out. */
export function subjectsShown(subjects: readonly string[] | null | undefined) {
  const distinct = [...new Set(subjects ?? [])]
  return { shown: distinct.slice(0, MAX_SUBJECTS), more: Math.max(0, distinct.length - MAX_SUBJECTS) }
}
