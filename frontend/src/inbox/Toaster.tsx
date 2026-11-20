import { X } from 'lucide-react'
import { UNDO_MS, type Toast } from './inboxContext'

/** Toasts slide up from the bottom (item 9); undo toasts show their remaining time as a shrinking bar. Errors use role="alert"; everything else is a polite status. */
export function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-tone={t.tone} role={t.tone === 'error' ? 'alert' : 'status'}>
          <span>{t.message}</span>
          {t.extra && (
            <button
              type="button"
              className="text-button toast-action"
              onClick={() => {
                onDismiss(t.id)
                t.extra?.run()
              }}
            >
              {t.extra.label}
            </button>
          )}
          {t.action && (
            <button
              type="button"
              className="text-button toast-action"
              onClick={() => {
                onDismiss(t.id)
                t.action?.run()
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            <X size={14} aria-hidden="true" />
          </button>
          {/* Undo toasts: a bar that shrinks (scaleX) over the undo window (item 9). */}
          {t.action && <span className="toast-bar" aria-hidden="true" style={{ animationDuration: `${UNDO_MS}ms` }} />}
        </div>
      ))}
    </div>
  )
}
