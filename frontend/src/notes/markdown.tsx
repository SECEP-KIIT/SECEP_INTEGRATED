// Markdown-lite (FR-CNT-003, decisions item 11): # headings, **bold**, *italics* / _italics_, `code`, - and 1. lists,
// - [ ] / - [x] checkboxes, [links](https://…). Rendered as React elements, never as HTML strings. Only http(s) and mailto links are made clickable.
import { Fragment, type ReactNode } from 'react'
import { NoteFile } from './NoteFile'
import { parseBlocks, type Block } from './markdownModel'

const INLINE = /(\[file:[0-9a-f-]{36}\]|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w*])\*[^*\s][^*]*\*(?!\w)|(?<!\w)_[^_\s][^_]*_(?!\w))/g

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    const k = `m${m.index}`
    if (t.startsWith('[file:')) out.push(<NoteFile key={k} id={t.slice(6, -1)} />)
    else if (t.startsWith('**')) out.push(<strong key={k}>{inline(t.slice(2, -2))}</strong>)
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!
      out.push(
        /^(https?:|mailto:)/i.test(href) ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {label}
          </a>
        ) : (
          <Fragment key={k}>{t}</Fragment>
        ),
      )
    } else out.push(<em key={k}>{inline(t.slice(1, -1))}</em>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

interface RenderProps {
  body: string
  onToggle?: (line: number) => void
  /** Extra controls after a checkbox line (→ Card, → Jira). */
  taskTools?: (text: string) => ReactNode
}

/** The rendered note. Lists group consecutive items. */
export function Markdown({ body, onToggle, taskTools }: RenderProps) {
  const blocks = parseBlocks(body)
  const out: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.kind === 'task' || b.kind === 'bullet' || b.kind === 'number') {
      const kind = b.kind === 'number' ? 'number' : 'list'
      const items: Block[] = []
      while (i < blocks.length && (kind === 'number' ? blocks[i].kind === 'number' : blocks[i].kind === 'task' || blocks[i].kind === 'bullet')) items.push(blocks[i++])
      i--
      const lis = items.map((it) =>
        it.kind === 'task' ? (
          <li key={it.line} className="md-task" data-done={it.done || undefined}>
            <input type="checkbox" checked={it.done} disabled={!onToggle} aria-label={it.text || 'Task'} onChange={() => onToggle?.(it.line)} onClick={(e) => e.stopPropagation()} />
            <span>{inline(it.text)}</span>
            {taskTools && it.text.trim() && !it.done && <span className="md-task-tools">{taskTools(it.text.trim())}</span>}
          </li>
        ) : (
          <li key={it.line}>{inline((it as { text: string }).text)}</li>
        ),
      )
      out.push(kind === 'number' ? <ol key={b.line}>{lis}</ol> : <ul key={b.line}>{lis}</ul>)
    } else if (b.kind === 'heading') {
      const H = (['h4', 'h5', 'h6'] as const)[b.level - 1]
      out.push(<H key={b.line}>{inline(b.text)}</H>)
    } else if (b.kind === 'para') out.push(<p key={b.line}>{inline(b.text)}</p>)
  }
  return <div className="md">{out}</div>
}
