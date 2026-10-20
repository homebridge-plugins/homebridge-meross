import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('axios', () => ({
  default: vi.fn(),
}))

const axios = (await import('axios')).default
const HttpClient = (await import('./http.js')).default

function networkError(code) {
  const err = new Error(code)
  err.code = code
  return err
}

function createClient(overrides = {}) {
  return new HttpClient({
    accountDetails: { domain: 'iotx.meross.com' },
    config: {
      username: 'user@example.com',
      password: 'secret',
      domain: 'iotx.meross.com',
      ...overrides.config,
    },
    ignoredDevices: [],
    log: {
      warn: vi.fn(),
      debug: vi.fn(),
    },
    storageData: {
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
    ...overrides,
  })
}

describe('cloud http timeouts and retries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    axios.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends login, device list, and hub requests with a 30 second timeout', async () => {
    // A literal, not the constant: on code with no timeout the constant is
    // missing too, and undefined would match undefined
    axios.mockResolvedValue({
      data: {
        info: 'Success',
        data: {
          token: 'token',
          key: 'key',
          userid: '1',
        },
      },
    })

    const client = createClient()
    await client.login()
    expect(axios.mock.calls[0][0].timeout).toBe(30000)

    client.token = 'token'
    axios.mockResolvedValueOnce({ data: { data: [] } })
    await client.getDevices()
    expect(axios.mock.calls[1][0].timeout).toBe(30000)

    axios.mockResolvedValueOnce({ data: { info: 'Success', data: [] } })
    await client.getSubDevices({ uuid: 'device-1' })
    expect(axios.mock.calls[2][0].timeout).toBe(30000)
  })

  it('keeps retrying a login dns failure, doubling the wait up to the ceiling', async () => {
    const failures = 7
    for (let i = 0; i < failures; i += 1) {
      axios.mockRejectedValueOnce(networkError('ENOTFOUND'))
    }
    axios.mockResolvedValue({
      data: { info: 'Success', data: { token: 'token', key: 'key', userid: '1' } },
    })
    const client = createClient()

    const pending = client.login()
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toMatchObject({ token: 'token' })

    expect(axios).toHaveBeenCalledTimes(failures + 1)
    const waitsInSeconds = client.log.warn.mock.calls.map(call => call[2])
    expect(waitsInSeconds).toEqual([30, 60, 120, 240, 300, 300, 300])
  })

  it('signs each retry afresh, so the nonce and timestamp are not reused', async () => {
    axios.mockRejectedValueOnce(networkError('ENOTFOUND'))
    axios.mockResolvedValue({
      data: { info: 'Success', data: { token: 'token', key: 'key', userid: '1' } },
    })
    const client = createClient()

    const pending = client.login()
    await vi.runAllTimersAsync()
    await pending

    const [first, second] = axios.mock.calls.map(call => call[0].data)
    expect(second.nonce).not.toBe(first.nonce)
    expect(second.timestamp).toBeGreaterThan(first.timestamp)
  })

  it('retries getDevices after a timeout until the cloud answers', async () => {
    axios.mockRejectedValueOnce(networkError('ECONNABORTED'))
    axios.mockRejectedValueOnce(networkError('ECONNABORTED'))
    axios.mockResolvedValue({ data: { data: [] } })
    const client = createClient()
    client.token = 'token'

    const pending = client.getDevices()
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual([])

    expect(axios).toHaveBeenCalledTimes(3)
  })

  it('does not retry a login that failed for a reason other than reachability', async () => {
    axios.mockResolvedValue({
      data: {
        apiStatus: 5000,
        info: 'Unknown or generic error',
        data: {},
      },
    })

    const client = createClient()
    await expect(client.login()).rejects.toThrow(/login failed/)
    expect(axios).toHaveBeenCalledTimes(1)
  })

  // After a power cut the router is often not up yet when Homebridge starts
  it.each(['ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'ECONNRESET'])(
    'retries a login that failed with %s until the cloud answers',
    async (code) => {
      axios.mockRejectedValueOnce(networkError(code))
      axios.mockRejectedValueOnce(networkError(code))
      axios.mockResolvedValue({
        data: { info: 'Success', data: { token: 'token', key: 'key', userid: '1' } },
      })
      const client = createClient()

      const pending = client.login()
      await vi.runAllTimersAsync()
      await expect(pending).resolves.toMatchObject({ token: 'token' })

      expect(axios).toHaveBeenCalledTimes(3)
    },
  )

  it('does not retry a wrong password', async () => {
    axios.mockResolvedValue({
      data: { apiStatus: 1004, info: 'Wrong password', data: {} },
    })

    const client = createClient()
    await expect(client.login()).rejects.toThrow(/login failed/)
    // The second call is the existing one-off try with the password base64 decoded
    expect(axios).toHaveBeenCalledTimes(2)
    expect(client.log.warn).not.toHaveBeenCalled()
  })

  it('does not retry a failed two-factor code', async () => {
    axios.mockResolvedValue({
      data: { apiStatus: 1032, info: 'MFA code required', data: {} },
    })

    const client = createClient()
    await expect(client.login()).rejects.toThrow()
    expect(axios).toHaveBeenCalledTimes(1)
    expect(client.log.warn).not.toHaveBeenCalled()
  })

  it('does not retry an error status from the cloud', async () => {
    axios.mockRejectedValue(networkError('ERR_BAD_REQUEST'))

    const client = createClient()
    await expect(client.login()).rejects.toThrow('ERR_BAD_REQUEST')
    expect(axios).toHaveBeenCalledTimes(1)
  })
})
