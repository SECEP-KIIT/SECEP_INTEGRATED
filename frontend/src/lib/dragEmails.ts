// Dragging email cards onto a sidebar project (FR-UI-028, item 8): native drag and drop, so it crosses from any
// column (virtualised lists included) to the sidebar without a shared dnd-kit context. Board moves use dnd-kit.
export const EMAILS_MIME = 'application/x-secep-emails'

export function startEmailDrag(e: DragEvent | React.DragEvent, ids: readonly string[]) {
  if (!e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData(EMAILS_MIME, JSON.stringify(ids))
  e.dataTransfer.setData('text/plain', ids.length === 1 ? '1 email' : `${ids.length} emails`)
}

export const carriesEmails = (e: React.DragEvent) => e.dataTransfer.types.includes(EMAILS_MIME)

export function droppedEmails(e: React.DragEvent): string[] {
  try {
    const ids: unknown = JSON.parse(e.dataTransfer.getData(EMAILS_MIME) || '[]')
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
