// Dev-only control panel for the mock backend (Ctrl+Shift+D). Never in production builds: it is reachable only
// through the dynamic import in main.tsx behind `import.meta.env.DEV && VITE_MOCK === '1'`.
import { useEffect, useState, type CSSProperties } from 'react'
import { api } from '../../api/client'
import { queryClient } from '../../api/queries'
import type { Me, PreferencesResponse, UiPrefs } from '../../api/types'
import { tabs } from '../browser'
import { control, setControl, type JiraMode } from '../control'
import { runDemo, sendOne } from '../pipeline'
import { fireReminderNow } from '../reminders'
import { currentSession, signIn, signOut } from '../session'
import { db, resetStore } from '../store/db'

const box: CSSProperties = {
  position: 'fixed', right: 12, bottom: 12, zIndex: 1000, width: 300, padding: 12, borderRadius: 12,
  background: 'rgb(20 24 38 / 0.94)', color: '#f4f6fb', font: '13px/1.4 system-ui, sans-serif', boxShadow: '0 8px 30px rgb(0 0 0 / 0.35)',
}
const row: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '6px 0' }
const btn: CSSProperties = { font: 'inherit', padding: '3px 8px', borderRadius: 6, border: '1px solid #5b6280', background: '#2a3048', color: 'inherit', cursor: 'pointer' }

/**
 * Sets ui_prefs.idle_minutes through the real PATCH /me/preferences, then puts the answer into the /me cache, so the
 * shell passes it to the lock controller (lock.configure) exactly as a Settings change would (task 16).
 */
async function setIdle(idle_minutes: UiPrefs['idle_minutes']) {
  const { ui_prefs } = await api<PreferencesResponse>('/me/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idle_minutes }),
  })
  queryClient.setQueryData<Me>(['me'], (me) => me && { ...me, ui_prefs: { ...ui_prefs } })
}

export function DevPanel() {
  const [open, setOpen] = useState(false)
  const [, rerender] = useState(0)
  const refresh = () => rerender((n) => n + 1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    addEventListener('keydown', onKey, { capture: true })
    return () => removeEventListener('keydown', onKey, { capture: true })
  }, [])

  if (!open) return null
  const session = currentSession()
  const set = (fn: () => void) => () => {
    fn()
    refresh()
  }

  return (
    <aside style={box} aria-label="Mock backend controls">
      <strong>Mock backend</strong> <span style={{ opacity: 0.7 }}>· Ctrl+Shift+D</span>
      <div style={row}>
        <button style={btn} onClick={sendOne}>Send one email</button>
        <button style={btn} onClick={runDemo}>Run §7.2 demo</button>
        <button style={btn} onClick={() => session && fireReminderNow(session.user_id)}>Fire a reminder</button>
      </div>
      <div style={row}>
        Incoming:
        <button style={btn} onClick={set(() => setControl({ paused: !control.paused }))}>{control.paused ? 'Resume' : 'Pause'}</button>
        {[1, 5, 20].map((s) => (
          <button key={s} style={{ ...btn, outline: control.speed === s ? '2px solid #7aa2ff' : undefined }} onClick={set(() => setControl({ speed: s }))}>
            {s}×
          </button>
        ))}
      </div>
      <div style={row}>
        User:
        <select
          value={session?.user_id ?? ''}
          onChange={(e) => {
            // A different user means a different cache, socket room and mailbox: start clean.
            signIn(e.target.value)
            location.reload()
          }}
        >
          {db.users.filter((u) => u.mailbox).map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name} ({u.is_admin ? 'admin' : u.permissions.includes('security.review') ? 'reviewer' : 'user'})
            </option>
          ))}
        </select>
      </div>
      <div style={row}>
        <button style={btn} onClick={set(signOut)}>Sign out</button>
      </div>
      <div style={row}>
        Idle lock:
        {([['1 min', 1], ['15 min', 15], ['off', null]] as const).map(([label, minutes]) => {
          const current = session && db.users.find((u) => u.id === session.user_id)?.ui_prefs.idle_minutes
          const active = (current === undefined ? 15 : current) === minutes
          return (
            <button key={label} style={{ ...btn, outline: active ? '2px solid #7aa2ff' : undefined }} onClick={() => void setIdle(minutes).then(refresh)}>
              {label}
            </button>
          )
        })}
      </div>
      <div style={row}>
        Jira:
        <select value={control.jiraMode} onChange={(e) => set(() => setControl({ jiraMode: e.target.value as JiraMode }))()}>
          <option value="ok">OK</option>
          <option value="rate_limited_once">429 once, then OK</option>
          <option value="server_error">503 (retries exhausted)</option>
          <option value="unauthorized">401</option>
          <option value="bad_request">400</option>
        </select>
      </div>
      <div style={row}>
        Latency:
        {([['off', [0, 0]], ['normal', [80, 250]], ['slow', [800, 1500]]] as const).map(([label, range]) => (
          <button
            key={label}
            style={{ ...btn, outline: control.latency[1] === range[1] ? '2px solid #7aa2ff' : undefined }}
            onClick={set(() => setControl({ latency: [...range] }))}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={row}>
        <button
          style={{ ...btn, borderColor: '#c4554d' }}
          onClick={() => {
            tabs.reset() // the other tabs reset and reload too, so none hands the old store back
            resetStore()
            location.reload()
          }}
        >
          Reset store
        </button>
        <span style={{ opacity: 0.7 }}>
          {db.emails.size} emails · {db.arrivals.length} arrived
        </span>
      </div>
    </aside>
  )
}
