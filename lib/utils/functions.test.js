import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  encodeParams,
  generateRandomString,
  hasProperty,
  parseCachedTemperature,
  parseDeviceHost,
  parseError,
} from './functions.js'

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
    const encoded = encodeParams({
      a: 'x'.repeat(200),
    })
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

describe('parseDeviceHost', () => {
  it('accepts an ip address', () => {
    expect(parseDeviceHost('192.0.2.10')).toBe('192.0.2.10')
    expect(parseDeviceHost(' 192.0.2.10 ')).toBe('192.0.2.10')
  })

  it('accepts a hostname, so an address that survives a dhcp change keeps working', () => {
    expect(parseDeviceHost('player-1.local')).toBe('player-1.local')
    expect(parseDeviceHost('Player-1.Local')).toBe('player-1.local')
    expect(parseDeviceHost('host.test')).toBe('host.test')
  })

  it('brackets an ipv6 address, which the url needs', () => {
    expect(parseDeviceHost('2001:db8::1')).toBe('[2001:db8::1]')
    expect(parseDeviceHost('[2001:db8::1]')).toBe('[2001:db8::1]')
  })

  it('keeps a port, as the address was used before', () => {
    expect(parseDeviceHost('192.0.2.10:8080')).toBe('192.0.2.10:8080')
    expect(parseDeviceHost('[2001:db8::1]:8080')).toBe('[2001:db8::1]:8080')
    expect(parseDeviceHost('192.0.2.10:80')).toBe('192.0.2.10')
  })

  it('gives the same host when parsed again', () => {
    // The parsed value is stored and parsed once more for each request.
    for (const address of [
      '192.0.2.10',
      'player-1.local',
      '2001:db8::1',
      '192.0.2.10:8080',
    ]) {
      const host = parseDeviceHost(address)
      expect(parseDeviceHost(host)).toBe(host)
    }
  })

  it('rejects a pasted url', () => {
    expect(parseDeviceHost('http://192.0.2.10')).toBeUndefined()
    expect(parseDeviceHost('http://192.0.2.10/config')).toBeUndefined()
    expect(parseDeviceHost('https://player-1.local')).toBeUndefined()
  })

  it('rejects a path, query or fragment', () => {
    expect(parseDeviceHost('192.0.2.10/config')).toBeUndefined()
    expect(parseDeviceHost('player-1.local/config')).toBeUndefined()
    expect(parseDeviceHost('192.0.2.10?a=1')).toBeUndefined()
    expect(parseDeviceHost('192.0.2.10#a')).toBeUndefined()
  })

  it('rejects credentials', () => {
    expect(parseDeviceHost('user:pass@192.0.2.10')).toBeUndefined()
    expect(parseDeviceHost('user@player-1.local')).toBeUndefined()
  })

  it('rejects whitespace inside the value, which the url parser would drop', () => {
    expect(parseDeviceHost('192.0.2.10\nhost.test')).toBeUndefined()
    expect(parseDeviceHost('player-1 .local')).toBeUndefined()
  })

  it('rejects an empty or non-string value', () => {
    expect(parseDeviceHost('')).toBeUndefined()
    expect(parseDeviceHost('   ')).toBeUndefined()
    expect(parseDeviceHost(undefined)).toBeUndefined()
    expect(parseDeviceHost(12)).toBeUndefined()
  })

  it('rejects a value that is not a valid host', () => {
    expect(parseDeviceHost('192.0.2.10:port')).toBeUndefined()
    expect(parseDeviceHost('999.0.2.10')).toBeUndefined()
  })
})

describe('parseCachedTemperature', () => {
  it('keeps finite numbers, including zero', () => {
    expect(parseCachedTemperature(21.5)).toBe(21.5)
    expect(parseCachedTemperature(0)).toBe(0)
    expect(parseCachedTemperature('19')).toBe(19)
  })

  it('skips non-numeric cache values', () => {
    expect(parseCachedTemperature('not-a-temperature')).toBeUndefined()
    expect(parseCachedTemperature(Number.NaN)).toBeUndefined()
    expect(parseCachedTemperature(undefined)).toBeUndefined()
    expect(parseCachedTemperature('')).toBeUndefined()
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
