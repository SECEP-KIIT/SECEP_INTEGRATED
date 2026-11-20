import { describe, expect, it } from 'vitest'
import { filterCount, highlight, NO_FILTERS, searchPath } from './searchQuery'

describe('search palette', () => {
  it('searches subjects first, the text on Go deeper, handled mail in the same list, and pages', () => {
    const p = (path: string) => new URL(path, 'http://x').searchParams
    const first = p(searchPath('budget q3', NO_FILTERS, false))
    expect([first.get('q'), first.get('q_in'), first.get('include_handled'), first.get('limit')]).toEqual(['budget q3', 'subject', 'true', '25'])
    expect(p(searchPath('budget', NO_FILTERS, true)).get('q_in')).toBe('all')
    expect(p(searchPath('budget', NO_FILTERS, false, 'abc')).get('cursor')).toBe('abc')
  })

  it('maps filters to GET /emails parameters; status filters leave handled mail out', () => {
    const f = { type: ['Task' as const], urgency: ['Critical' as const, 'High' as const], view: ['unread' as const], includeHandled: true }
    const p = new URL(searchPath('', f, false), 'http://x').searchParams
    expect([p.get('type'), p.get('urgency'), p.get('view'), p.get('q'), p.get('include_handled')]).toEqual(['Task', 'Critical,High', 'unread', null, null])
    expect(filterCount(f)).toBe(4)
    expect(new URL(searchPath('x', { ...NO_FILTERS, includeHandled: false }, false), 'http://x').searchParams.get('include_handled')).toBeNull()
  })

  it('highlights every query word, case-insensitive, as plain-text pieces', () => {
    expect(highlight('Q3 Budget review', 'budget q3')).toEqual([
      { text: 'Q3', hit: true },
      { text: ' ', hit: false },
      { text: 'Budget', hit: true },
      { text: ' review', hit: false },
    ])
    expect(highlight('<b>x</b>', 'x').map((p) => p.text).join('')).toBe('<b>x</b>')
  })
})
