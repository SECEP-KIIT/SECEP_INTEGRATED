import { Ban, ExternalLink, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { useState } from 'react'
import { followLink } from '../api/queries'
import type { GoResponse, LinkView } from '../api/types'
import { errorText } from '../inbox/inboxContext'

/**
 * Opens a URL the click-time check returned, in a new tab with no opener and no referrer, so the page can't reach
 * back into SECEP (window.opener) or learn which email it came from (Referer). Only http(s): a javascript: or data:
 * URL from a compromised resolver can never run here.
 */
function safeOpen(url: string) {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  window.open(u.href, '_blank', 'noopener,noreferrer')
  return true
}

const VERDICT = {
  pending: { label: 'Still being checked', Icon: ShieldAlert },
  clean: { label: 'Checked: clean', Icon: ShieldCheck },
  suspicious: { label: 'Suspicious', Icon: ShieldAlert },
  malicious: { label: 'Malicious', Icon: ShieldX },
} as const

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ready'; url: string }
  | { kind: 'error'; message: string }
  | { kind: 'result'; go: Exclude<GoResponse, { action: 'open' }> }

/**
 * Whether the click that started the check still allows opening a tab (proposals §11.2). A slow check can outlast
 * the browser's transient activation (about 5 s), and with noopener window.open returns null either way, so a block
 * can't be detected afterwards. Browsers without the API are assumed active.
 */
const canStillOpen = () => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true

/**
 * Links & security (FR-SEC-004): the only clickable links are LinkView entries, and every click goes through the
 * click-time check (GET /links/:checkId/go), which may have a newer verdict than the card. URLs in the body text are
 * never linked. Pending links aren't clickable yet. Suspicious links need an explicit "Open anyway"; malicious ones
 * never open. The full-page interstitial comes with the security flows (task 15).
 */
export function LinkList({ links }: { links: LinkView[] }) {
  if (links.length === 0) return <p className="drawer-muted">No links in this email.</p>
  return (
    <ul className="link-list">
      {links.map((l, i) => (
        <LinkRow key={l.check_id ?? `pending-${i}`} link={l} />
      ))}
    </ul>
  )
}

function LinkRow({ link }: { link: LinkView }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const { label, Icon } = VERDICT[link.verdict]

  const go = async () => {
    if (!link.go_url) return
    setState({ kind: 'checking' })
    try {
      const res = await followLink(link.go_url)
      if (res.action === 'open') {
        if (!canStillOpen()) setState({ kind: 'ready', url: res.url })
        else setState(safeOpen(res.url) ? { kind: 'idle' } : { kind: 'error', message: 'This link can’t be opened safely.' })
      } else {
        setState({ kind: 'result', go: res })
      }
    } catch (err) {
      setState({ kind: 'error', message: errorText(err) })
    }
  }

  return (
    <li className="link" data-verdict={link.verdict}>
      <div className="link-head">
        <span className="link-verdict" title={label}>
          <Icon size={14} aria-hidden="true" />
          <span>{label}</span>
        </span>
        <span className="link-text">
          {link.anchor_text && <span className="link-anchor">{link.anchor_text}</span>}
          <span className="link-host">{link.host}</span>
        </span>
        <button
          type="button"
          className="ghost-button"
          disabled={!link.go_url || state.kind === 'checking'}
          aria-busy={state.kind === 'checking' || undefined}
          onClick={go}
          title={link.go_url ? 'Checks the link again, then opens it in a new tab' : 'Not checked yet'}
        >
          <ExternalLink size={14} aria-hidden="true" />
          Open
          <span className="sr-only"> {link.anchor_text ?? link.host}</span>
        </button>
      </div>

      {state.kind === 'ready' && (
        <p className="link-ready" role="status">
          <ShieldCheck size={14} aria-hidden="true" /> Checked: clean.
          <button
            type="button"
            className="text-button"
            onClick={() => setState(safeOpen(state.url) ? { kind: 'idle' } : { kind: 'error', message: 'This link can’t be opened safely.' })}
          >
            Open it now
          </button>
        </p>
      )}
      {state.kind === 'error' && (
        <p className="action-error" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === 'result' && state.go.action === 'interstitial' && (
        <div className="link-warning" role="alert">
          <p className="link-warning-title">
            <ShieldAlert size={16} aria-hidden="true" /> This link looks suspicious
          </p>
          <p>
            It leads to <span className="link-final">{state.go.final_url}</span>
          </p>
          <Details chain={state.go.chain} signals={state.go.signals} />
          <div className="action-buttons">
            <button type="button" className="primary-button" onClick={() => setState({ kind: 'idle' })}>
              Go back
            </button>
            <button
              type="button"
              className="text-button text-button-danger"
              onClick={() => {
                if (state.go.action === 'interstitial') setState(safeOpen(state.go.final_url) ? { kind: 'idle' } : { kind: 'error', message: 'This link can’t be opened safely.' })
              }}
            >
              Open anyway
            </button>
          </div>
        </div>
      )}
      {state.kind === 'result' && state.go.action === 'blocked' && (
        <div className="link-warning" data-blocked role="alert">
          <p className="link-warning-title">
            <Ban size={16} aria-hidden="true" /> Blocked: this link is malicious
          </p>
          <Details chain={state.go.chain} signals={state.go.signals} />
        </div>
      )}
    </li>
  )
}

/** Redirect chain and the signals behind the verdict, as plain text (never links). */
function Details({ chain, signals }: { chain: string[]; signals: string[] }) {
  return (
    <>
      {signals.length > 0 && <p className="drawer-muted">Why: {signals.join(', ')}</p>}
      {chain.length > 1 && (
        <ol className="link-chain" aria-label="Redirects">
          {chain.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ol>
      )}
    </>
  )
}
