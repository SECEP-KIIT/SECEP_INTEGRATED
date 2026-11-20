import { Hand, MessageSquare, Phone } from 'lucide-react'
import type { UserCardPayload } from '../api/types'

/** Where a user card came from (FR-CNT-002): shown where an email card shows its type icon. */
export const SOURCE_ICON: Record<NonNullable<UserCardPayload['source']>, { icon: typeof Hand; label: string }> = {
  in_person: { icon: Hand, label: 'In person' },
  call: { icon: Phone, label: 'Call' },
  chat: { icon: MessageSquare, label: 'Chat' },
}

export type Source = NonNullable<UserCardPayload['source']>
export const SOURCES = (Object.keys(SOURCE_ICON) as Source[]).map((key) => ({ key, ...SOURCE_ICON[key] }))
