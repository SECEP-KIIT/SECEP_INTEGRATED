import { describe, expect, it } from 'vitest'
import { subjectsShown } from './lockSubjects'

describe('subjectsShown (lock screen)', () => {
  it('merges duplicates and shows three at most', () => {
    expect(subjectsShown(['a', 'b', 'a', 'c', 'd', 'b', 'e'])).toEqual({ shown: ['a', 'b', 'c'], more: 2 })
    expect(subjectsShown(['a', 'a'])).toEqual({ shown: ['a'], more: 0 })
    expect(subjectsShown(null)).toEqual({ shown: [], more: 0 })
  })
})
