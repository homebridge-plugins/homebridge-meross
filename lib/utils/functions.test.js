import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { encodeParams, generateRandomString, hasProperty, parseError } from './functions.js'

describe('encodeParams', () => {
  it('base64 encodes the json body the meross cloud expects', () => {
    const encoded = encodeParams({ email: 'a@b.com', password: 'x' })
    expect(JSON.parse(Buffer.from(encoded, 'base64').toString())).toEqual({
      email: 'a@b.com',
      password: 'x',
    })
  })

  it('produces valid base64 with no line breaks', () => {
    // The value goes straight into a request body, so a wrapped or padded
    // encoding would be rejected by the cloud.
    const encoded = encodeParams({ a: 'x'.repeat(200) })
    expect(encoded).toMatch(/^[A-Z0-9+/]+=*$/i)
  })

  it('handles an empty object', () => {
    expect(Buffer.from(encodeParams({}), 'base64').toString()).toBe('{}')
  })
})

describe('generateRandomString', () => {
  it('returns the requested length', () => {
    expect(generateRandomString(16)).toHaveLength(16)
    expect(generateRandomString(1)).toHaveLength(1)
  })

  it('uses only lowercase letters and digits', () => {
    // The nonce is signed alongside the request, so any character outside the
    // documented set risks a signature mismatch.
    expect(generateRandomString(200)).toMatch(/^[a-z0-9]+$/)
  })

  it('does not return the same value twice in a row', () => {
    expect(generateRandomString(32)).not.toBe(generateRandomString(32))
  })
})

describe('hasProperty', () => {
  it('detects own properties only', () => {
    expect(hasProperty({ a: 1 }, 'a')).toBe(true)
    expect(hasProperty({ a: undefined }, 'a')).toBe(true)
    expect(hasProperty({}, 'a')).toBe(false)
  })

  it('ignores inherited properties', () => {
    // A device payload with no "toString" key must not read as having one.
    expect(hasProperty({}, 'toString')).toBe(false)
  })
})

describe('parseError', () => {
  it('appends the first stack frame to the message', () => {
    const err = new Error('boom')
    err.stack = 'Error: boom\n    at thing (/a.js:1:1)'
    expect(parseError(err)).toBe('boom at thing (/a.js:1:1)')
  })

  it('returns just the message when the error is listed in hideStack', () => {
    // Routine failures - a device being unreachable - are logged without a
    // stack so the log stays readable.
    const err = new Error('offline')
    err.stack = 'Error: offline\n    at thing (/a.js:1:1)'
    expect(parseError(err, ['offline'])).toBe('offline')
  })

  it('returns the message when there is no stack at all', () => {
    const err = new Error('nostack')
    err.stack = ''
    expect(parseError(err)).toBe('nostack')
  })
})
