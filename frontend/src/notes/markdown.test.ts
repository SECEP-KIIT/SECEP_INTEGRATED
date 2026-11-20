import { describe, expect, it } from 'vitest'
import { parseBlocks, toggleTask } from './markdownModel'

describe('markdown-lite (FR-CNT-003)', () => {
  it('splits headings, tasks, bullets, numbers and paragraphs by line', () => {
    const kinds = parseBlocks('## Agenda\n- [ ] Book room\n- [x] Send invite\n- note\n1. first\n\nplain').map((b) => b.kind)
    expect(kinds).toEqual(['heading', 'task', 'task', 'bullet', 'number', 'gap', 'para'])
  })
  it('toggles exactly one checkbox line', () => {
    expect(toggleTask('- [ ] a\n- [ ] b', 1)).toBe('- [ ] a\n- [x] b')
    expect(toggleTask('- [x] a', 0)).toBe('- [ ] a')
  })
})
