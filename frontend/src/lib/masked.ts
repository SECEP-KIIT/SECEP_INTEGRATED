// The server replaces secrets with [MASKED:<type>] before storage (FR-SEC-006); we only render those tokens.
export type Segment = { text: string } | { secretType: string }

const MASK = /\[MASKED:([a-z0-9_]+)\]/gi

export function parseMasked(text: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(MASK)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ secretType: m[1].toLowerCase() })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

const LABELS: Record<string, string> = {
  api_key: 'API key',
  otp: 'one-time code',
  jwt: 'token',
  pem_private_key: 'private key',
  card_number: 'card number',
}

export const secretLabel = (type: string) => LABELS[type] ?? type.replace(/_/g, ' ')
