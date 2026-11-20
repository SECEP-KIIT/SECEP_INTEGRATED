import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { useGlance, useMe } from '../api/queries'
import type { AdminMetrics, EmailType, HeadMetrics } from '../api/types'
import './stats.css'

const TYPES: EmailType[] = ['Task', 'Meeting', 'Approval', 'Info', 'Credentials']

/**
 * Stats (the Metrics page as a home widget, 19 Nov 2026). Everyone: today's counts from GET /me/glance. Admins also
 * get the classifier over 30 days from GET /admin/metrics (§6.5, admin-only; urgency and sentiment per proposals
 * §25.1), switchable between type, urgency and sentiment: volume and share per label, how often people corrected it,
 * and a labelled confidence histogram. Bars carry their numbers as text, never length alone.
 */
export function StatsWidget() {
  const glance = useGlance()
  const { data: me } = useMe()
  const admin = !!me?.is_admin
  const metrics = useQuery({ queryKey: ['admin', 'metrics', 30], queryFn: () => api<AdminMetrics>('/admin/metrics?days=30'), enabled: admin, staleTime: 5 * 60_000 })
  const c = glance.data?.counts

  return (
    <div className="stats">
      <section aria-label="Right now">
        <h4 className="stats-head">Right now</h4>
        {c ? (
          <ul className="stats-tiles">
            <Tile label="Unread" value={c.inbox_unread} />
            <Tile label="Critical unread" value={c.critical_unread} tone="crit" />
            <Tile label="Due today" value={c.due_today} />
            <Tile label="Overdue" value={c.overdue} tone="warn" />
            <Tile label="Board to do" value={c.board_todo} />
            {c.security_flags !== null && <Tile label="Security flags" value={c.security_flags} />}
          </ul>
        ) : (
          <p className="col-state">{glance.isError ? "Couldn't load the counts." : 'Loading…'}</p>
        )}
      </section>

      {admin && (
        <section aria-label="Classifier, last 30 days">
          <h4 className="stats-head">Classifier · last 30 days</h4>
          {metrics.data ? <Classifier m={metrics.data} /> : <p className="col-state">{metrics.isError ? "Couldn't load the classifier metrics." : 'Loading…'}</p>}
        </section>
      )}
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'crit' | 'warn' }) {
  return (
    <li className="stats-tile" data-tone={tone}>
      <span className="stats-num">{value}</span>
      <span className="stats-label">{label}</span>
    </li>
  )
}

type Head = 'type' | 'urgency' | 'sentiment'
const HEADS: { id: Head; label: string; labels: readonly string[] }[] = [
  { id: 'type', label: 'Type', labels: TYPES },
  { id: 'urgency', label: 'Urgency', labels: ['Critical', 'High', 'Medium', 'Low'] },
  { id: 'sentiment', label: 'Sentiment', labels: ['Positive', 'Neutral', 'Negative', 'Frustrated'] },
]
const pct = (x: number) => `${Math.round(x * 100)} %`

/** One classifier head (type, urgency or sentiment), whichever the switch shows: volume, corrections, confidence. */
function pick(m: AdminMetrics, h: Head): HeadMetrics<string> {
  if (h === 'type') return { volume: m.volume_by_type, override_rate: m.override_rate_by_class, confidence_histogram: m.confidence_histogram }
  return m[h]
}

function Classifier({ m }: { m: AdminMetrics }) {
  const [head, setHead] = useState<Head>('type')
  const def = HEADS.find((h) => h.id === head)!
  const d = pick(m, head)
  const total = def.labels.reduce((s, l) => s + (d.volume[l] ?? 0), 0)
  const maxN = Math.max(1, ...def.labels.map((l) => d.volume[l] ?? 0))
  const corrected = def.labels.reduce((s, l) => s + (d.volume[l] ?? 0) * (d.override_rate[l] ?? 0), 0)
  const sure = d.confidence_histogram.filter((b) => b.bin_start >= 0.8).reduce((s, b) => s + b.count, 0)
  const maxBin = Math.max(1, ...d.confidence_histogram.map((b) => b.count))

  return (
    <>
      <div className="stats-switch" role="group" aria-label="Classifier output">
        {HEADS.map((h) => (
          <button key={h.id} type="button" aria-pressed={h.id === head} onClick={() => setHead(h.id)}>
            {h.label}
          </button>
        ))}
      </div>

      <ul className="stats-kpis">
        <li>
          <span className="stats-num">{total}</span>
          <span className="stats-label">emails labelled</span>
        </li>
        <li>
          <span className="stats-num">{total ? pct(sure / total) : '–'}</span>
          <span className="stats-label">at ≥ 80 % confidence</span>
        </li>
        <li>
          <span className="stats-num">{total ? pct(corrected / total) : '–'}</span>
          <span className="stats-label">corrected by people</span>
        </li>
      </ul>

      <table className="stats-table">
        <caption className="sr-only">{def.label}: emails per label, share, and how often the label was corrected</caption>
        <thead>
          <tr>
            <th scope="col">{def.label}</th>
            <th scope="col">Emails</th>
            <th scope="col">Share</th>
            <th scope="col">Corrected</th>
          </tr>
        </thead>
        <tbody>
          {def.labels.map((l) => {
            const n = d.volume[l] ?? 0
            return (
              <tr key={l}>
                <th scope="row">{l}</th>
                <td>
                  <span className="stats-bar" aria-hidden="true">
                    <span style={{ transform: `scaleX(${n / maxN})` }} />
                  </span>
                  {n}
                </td>
                <td>{total ? pct(n / total) : '–'}</td>
                <td>{pct(d.override_rate[l] ?? 0)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <figure className="stats-fig">
        <figcaption className="stats-sub">How sure the classifier was ({def.label.toLowerCase()}), emails per 10 % band</figcaption>
        <div className="stats-chart">
          <span className="stats-ytitle" aria-hidden="true">
            Emails
          </span>
          <ol className="stats-hist">
            {d.confidence_histogram.map((b) => (
              <li key={b.bin_start} title={`${pct(b.bin_start)}–${pct(b.bin_end)}: ${b.count} emails`}>
                <span className="stats-count" data-zero={b.count === 0 || undefined}>
                  {b.count}
                  <span className="sr-only">
                    {' '}
                    emails at {pct(b.bin_start)} to {pct(b.bin_end)}
                  </span>
                </span>
                <span className="stats-col" aria-hidden="true">
                  <span style={{ transform: `scaleY(${b.count / maxBin})` }} />
                </span>
              </li>
            ))}
          </ol>
          <ol className="stats-ticks" aria-hidden="true">
            {d.confidence_histogram.map((b) => (
              <li key={b.bin_start}>{Math.round(b.bin_start * 100)}</li>
            ))}
            <li className="stats-tick-end">100</li>
          </ol>
          <span className="stats-xtitle" aria-hidden="true">
            Confidence (%) → higher is surer
          </span>
        </div>
      </figure>
    </>
  )
}
