import { describe, expect, it } from 'vitest'
import { parseMasked } from './masked'

describe('parseMasked', () => {
  it('splits text around mask tokens', () => {
    expect(parseMasked('code [MASKED:otp] expires, key [MASKED:API_KEY].')).toEqual([
      { text: 'code ' },
      { secretType: 'otp' },
      { text: ' expires, key ' },
      { secretType: 'api_key' },
      { text: '.' },
    ])
  })

  it('leaves unmasked text alone', () => {
    expect(parseMasked('plain')).toEqual([{ text: 'plain' }])
  })
})
