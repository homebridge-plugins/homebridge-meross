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
  const services = new Map([
    ['Fan', makeService()],
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
      options: option === undefined ? {} : { hideLight: option },
    },
    getService(name) {
      return services.get(name) || null
    },
    addService(type, name) {
      const service = makeService()
      services.set(name || type, service)
      operations.push(`add:${name || type}`)
      return service
    },
    removeService(service) {
      const entry = [...services.entries()]
        .find(([, value]) => value === service)

      assert.ok(entry, 'service must exist before removal')
      services.delete(entry[0])
      operations.push(`remove:${entry[0]}`)
    },
    log: vi.fn(),
    logWarn: vi.fn(),
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
