// §6.4.1 lists: { items, next_cursor }. The cursor is opaque to the client; limit defaults to 25, maximum 50.
import type { Page } from '../../api/types'
import { Fail } from './route'

const encode = (offset: number) => btoa(JSON.stringify({ o: offset }))

function decode(cursor: string): number {
  try {
    const { o } = JSON.parse(atob(cursor)) as { o: unknown }
    if (Number.isInteger(o) && (o as number) >= 0) return o as number
  } catch {
    // fall through
  }
  throw new Fail(400, 'bad_request', 'Invalid cursor')
}

export function page<T>(url: URL, items: T[]): Page<T> {
  const rawLimit = url.searchParams.get('limit')
  const limit = rawLimit === null ? 25 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Fail(400, 'bad_request', 'limit must be 1–50')
  const cursor = url.searchParams.get('cursor')
  const offset = cursor ? decode(cursor) : 0
  const next = offset + limit
  return { items: items.slice(offset, next), next_cursor: next < items.length ? encode(next) : null }
}
