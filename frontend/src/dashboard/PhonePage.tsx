import type { ReactNode } from 'react'
import type { LayoutPage } from '../api/types'

/**
 * Phone pages (FR-UI-009 as changed in proposals §16.4, option A): the page's widgets in order as sections
 * (PhoneSection: title and count, the top three cards, "See all") in one vertical scroll. Hidden ones are left out;
 * the edit sheet (PhoneEditSheet) reorders and hides them.
 */
export function PhonePage({ page, render }: { page: LayoutPage; render: (id: string) => ReactNode }) {
  return (
    <div className="phone-page">
      {page.widgets
        .filter((w) => !w.hidden)
        .map((w) => (
          <div key={w.id} className="phone-item">
            {render(w.id)}
          </div>
        ))}
    </div>
  )
}
