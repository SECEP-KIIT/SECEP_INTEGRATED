/**
 * Project marker with its progress ring (FR-UI-002, item 1: "coloured dots with names and progress rings"): the
 * project's colour dot sits inside an arc showing done / total. It lives in the icon column, so the ring shows in
 * the collapsed sidebar as well as the expanded one. FR-UI-020: the arc turns amber when tasks are overdue and red
 * when the deadline is under 48 h with progress under 70 %; the label says so too, never colour alone.
 */
export function ProgressRing({ done, total, colour, stroke, warning, size = 22 }: {
  done: number
  total: number
  colour: string
  /** The arc's colour when it differs from the dot's (a warning tone). */
  stroke?: string
  warning?: string | null
  size?: number
}) {
  const pct = total ? Math.round((done / total) * 100) : 0
  const label = `${done} of ${total} done${warning ? `. ${warning}` : ''}`
  return (
    <svg className="progress-ring" width={size} height={size} viewBox="0 0 22 22" role="img" aria-label={label} data-warning={warning ? '' : undefined}>
      <circle cx="11" cy="11" r="9" pathLength="100" className="progress-ring-track" style={warning ? { stroke: stroke } : undefined} />
      {pct > 0 && (
        <circle
          cx="11"
          cy="11"
          r="9"
          pathLength="100"
          stroke={stroke ?? colour}
          strokeDasharray={`${pct} 100`}
          transform="rotate(-90 11 11)"
          className="progress-ring-value"
        />
      )}
      <circle cx="11" cy="11" r="4" fill={colour} className="progress-ring-dot" />
    </svg>
  )
}
