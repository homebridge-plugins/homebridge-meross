import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeAccessory } from './harness.js'

/**
 * A local device whose configured address is unusable (a pasted url, or one
 * with credentials in it) has that address ignored, so no request is built
 * from it. Its accessory must still be kept. Dropping the device from the
 * local list made the clean-up at the end of start-up remove the accessory,
 * and the user lost its room and automations in HomeKit.
 */

vi.mock('axios', () => ({ default: vi.fn() }))

// These build real HAP classes, which a plain object api cannot provide
vi.mock('../lib/utils/custom-chars.js', () => ({ default: class {} }))
vi.mock('../lib/utils/eve-chars.js', () => ({ default: class {} }))
vi.mock('../lib/fakegato/fakegato-history.js', () => ({ default: () => class {} }))

// Every device handler is replaced by one that only records it was built
vi.mock('../lib/device/index.js', () => {
  class FakeHandler {
    constructor(platform, accessory) {
      this.accessory = accessory
    }
  }
  return { default: new Proxy({}, { get: () => FakeHandler }) }
})

const axios = (await import('axios')).default
const Platform = (await import('../lib/platform.js')).default

const SERIAL = '2104000000000000000000000000abcd'

function nameProxy() {
  return new Proxy({}, { get: (_target, prop) => (typeof prop === 'string' ? prop : undefined) })
}

function makeLog() {
  const log = vi.fn()
  log.warn = vi.fn()
  log.error = vi.fn()
  log.debug = vi.fn()
  return log
}

function makeApi(storagePath) {
  return {
    versionGreaterOrEqual: () => true,
    serverVersion: '2.0.0',
    on: vi.fn(),
    user: { storagePath: () => storagePath },
    hap: {
      HAPLibraryVersion: () => '1.0.0',
      Service: nameProxy(),
      Characteristic: nameProxy(),
      uuid: { generate: input => `uuid-${input}` },
    },
    platformAccessory: FakeAccessory,
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    updatePlatformAccessories: vi.fn(),
  }
}

// A local-only setup: a user key and no cloud login
function makeConfig(deviceUrl) {
  return {
    platform: 'Meross',
    userkey: '0123456789abcdef0123456789abcdef',
    singleDevices: [{ serialNumber: SERIAL, name: 'Lamp', model: 'MSS110', deviceUrl }],
  }
}

async function startWithCachedAccessory(deviceUrl, storagePath) {
  const log = makeLog()
  const api = makeApi(storagePath)
  const platform = new Platform(log, makeConfig(deviceUrl), api)

  // The accessory Homebridge restores from its cache, from when the address worked
  // Shaped like a HAP accessory, whose services hold an array of characteristics
  const cached = {
    UUID: `uuid-${SERIAL}`,
    displayName: 'Lamp',
    context: { connection: 'local', serialNumber: SERIAL, model: 'MSS110' },
    services: [],
  }
  platform.configureAccessory(cached)

  await platform.pluginSetup()
  return { api, cached, log, platform }
}

describe('a local device with an unusable address', () => {
  let storagePath

  beforeEach(() => {
    storagePath = mkdtempSync(join(tmpdir(), 'meross-test-'))
    axios.mockReset()
  })

  afterEach(() => {
    rmSync(storagePath, { recursive: true, force: true })
  })

  it('keeps its accessory, so its room and automations survive', async () => {
    const { api, cached, platform } = await startWithCachedAccessory('http://192.0.2.10/config', storagePath)

    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(platform.devicesInHB.get(cached.UUID)).toBe(cached)

    // It is still set up as a local device, so it shows as not responding
    // rather than sitting in HomeKit with no handler behind it
    expect(cached.control).toBeDefined()
    expect(cached.context.connection).toBe('local')
  })

  it('still warns that the address was ignored, and builds no request from it', async () => {
    const { cached, log, platform } = await startWithCachedAccessory('user:pass@192.0.2.10', storagePath)

    const warnings = log.warn.mock.calls.map(call => call.join(' '))
    expect(warnings.some(line => line.includes(`singleDevices.${SERIAL}.deviceUrl`))).toBe(true)
    expect(cached.context.deviceUrl).toBeUndefined()

    await expect(platform.sendUpdate(cached, { namespace: 'Appliance.System.All', payload: {} }))
      .rejects
      .toThrow(/no IP address/)
    expect(axios).not.toHaveBeenCalled()
  })

  it('uses a usable address as before', async () => {
    const { api, cached } = await startWithCachedAccessory('192.0.2.10', storagePath)

    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(cached.context.connection).toBe('local')
    expect(cached.context.deviceUrl).toBe('192.0.2.10')
  })
})
