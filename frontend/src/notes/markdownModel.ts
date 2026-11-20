// Markdown-lite block model (FR-CNT-003): one block per line. Rendering is in markdown.tsx.

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; line: number }
  | { kind: 'task'; done: boolean; text: string; line: number }
  | { kind: 'bullet'; text: string; line: number }
  | { kind: 'number'; n: string; text: string; line: number }
  | { kind: 'para'; text: string; line: number }
  | { kind: 'gap'; line: number }

export function parseBlocks(body: string): Block[] {
  return body.split('\n').map((raw, line): Block => {
    let m: RegExpExecArray | null
    if ((m = /^(#{1,3})\s+(.*)$/.exec(raw))) return { kind: 'heading', level: m[1].length as 1 | 2 | 3, text: m[2], line }
    if ((m = /^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/.exec(raw))) return { kind: 'task', done: m[1] !== ' ', text: m[2], line }
    if ((m = /^\s*[-*]\s+(.*)$/.exec(raw))) return { kind: 'bullet', text: m[1], line }
    if ((m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(raw))) return { kind: 'number', n: m[1], text: m[2], line }
    return raw.trim() ? { kind: 'para', text: raw, line } : { kind: 'gap', line }
  })
}

/** Flips the checkbox on one line of the body. */
export const toggleTask = (body: string, line: number) =>
  body
    .split('\n')
    .map((l, i) => (i === line ? l.replace(/\[( |x|X)\]/, (_, c: string) => (c === ' ' ? '[x]' : '[ ]')) : l))
    .join('\n')

