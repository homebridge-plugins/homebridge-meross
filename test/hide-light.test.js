import assert from 'node:assert/strict'

import { afterEach, beforeEach, it, vi } from 'vitest'

import MerossFan from '../lib/device/fan.js'

const characteristic = {
  On: 'On',
  RotationSpeed: 'RotationSpeed',
  Brightness: 'Brightness',
}

const serviceType = {
  Fan: 'Fan',
  Lightbulb: 'Lightbulb',
}

function makeService() {
  const characteristics = new Map()

  return {
    getCharacteristic(key) {
      if (!characteristics.has(key)) {
        characteristics.set(key, {
          value: 0,
          onSet(handler) {
            this.handler = handler
            return this
          },
          setProps(props) {
            this.props = props
            return this
          },
        })
      }
      return characteristics.get(key)
    },
    updateCharacteristic: vi.fn(),
  }
}

function makeFixture(option, cachedLight = false) {
  // the fan a current version leaves in the cache
  const services = new Map([
    [
      'Fan',
      Object.assign(makeService(), { subtype: 'fan-speed' }),
    ],
  ])

  if (cachedLight) {
    services.set('Light', makeService())
  }

  const operations = []
  const sendUpdate = vi.fn()

  const accessory = {
    displayName: 'Test Fan',
    context: {
      connection: 'local',
      options: option === undefined
        ? {}
        : { hideLight: option },
    },
    getService(name) {
      return services.get(name) || null
    },
    getServiceById(type, subtype) {
      return [
        ...services.values(),
      ].find(service => service.subtype === subtype) || null
    },
    addService(type, name, subtype) {
      const service = Object.assign(makeService(), { subtype })
      services.set(name || type, service)
      operations.push(`add:${name || type}`)
      return service
    },
    removeService(service) {
      const entry = [
        ...services.entries(),
      ]
        .find(([, value]) => value === service)

      assert.ok(entry, 'service must exist before removal')
      services.delete(entry[0])
      operations.push(`remove:${entry[0]}`)
    },
    log: vi.fn(),
    logWarn: vi.fn(),
    logDebug: vi.fn(),
  }

  const platform = {
    api: {
      hap: {
        Characteristic: characteristic,
        HapStatusError: Error,
        Service: serviceType,
      },
    },
    config: {},
    log: vi.fn(),
    sendUpdate,
  }

  function initialize() {
    return new MerossFan(platform, accessory)
  }

  return {
    accessory,
    services,
    operations,
    sendUpdate,
    initialize,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('preserves the light service by default', () => {
  const fixture = makeFixture(undefined)
  const fan = fixture.initialize()

  assert.ok(fan.lightService)
  assert.ok(fixture.services.has('Light'))
  assert.ok(fixture.services.has('Fan'))
})

it('preserves a cached light when disabled', () => {
  const fixture = makeFixture(false, true)
  const fan = fixture.initialize()

  assert.ok(fan.lightService)
  assert.deepEqual(fixture.operations, [])
})

it('does not create a light when enabled', () => {
  const fixture = makeFixture(true)
  const fan = fixture.initialize()

  assert.equal(fan.lightService, undefined)
  assert.equal(fixture.services.has('Light'), false)
  assert.ok(fixture.services.has('Fan'))
})

it('removes a cached light when enabled', () => {
  const fixture = makeFixture(true, true)
  const fan = fixture.initialize()

  assert.equal(fan.lightService, undefined)
  assert.deepEqual(fixture.operations, ['remove:Light'])
  assert.ok(fixture.services.has('Fan'))
})

it('restores light on the same accessory when disabled', () => {
  const fixture = makeFixture(true, true)
  fixture.initialize()

  assert.equal(fixture.services.has('Light'), false)

  fixture.accessory.context.options.hideLight = false
  const restored = fixture.initialize()

  assert.ok(restored.lightService)
  assert.ok(fixture.services.has('Light'))
  assert.deepEqual(fixture.operations, [
    'remove:Light',
    'add:Light',
  ])
})

it('does not send physical Meross commands on initialization', () => {
  const fixture = makeFixture(true, true)
  fixture.initialize()

  assert.equal(fixture.sendUpdate.mock.calls.length, 0)
  assert.deepEqual(fixture.operations, ['remove:Light'])
})

// Home kept a fan's old 0-3 speed range on the old service, so every speed
// picked in Home arrived as 0 (#830). A cached fan moves to a new service.
it('replaces a cached fan service of the old subtype with a new one', () => {
  const fixture = makeFixture(true)
  const cachedFan = fixture.services.get('Fan')
  cachedFan.subtype = 'fan'
  const fan = fixture.initialize()

  assert.deepEqual(fixture.operations.slice(0, 2), ['remove:Fan', 'add:Fan'])
  assert.notEqual(fan.fanService, cachedFan)
  assert.equal(fan.fanService.subtype, 'fan-speed')
})

it('keeps a cached fan service of the new subtype', () => {
  const fixture = makeFixture(true)
  const cachedFan = fixture.services.get('Fan')
  const fan = fixture.initialize()

  assert.equal(fixture.operations.includes('remove:Fan'), false)
  assert.equal(fan.fanService, cachedFan)
})
