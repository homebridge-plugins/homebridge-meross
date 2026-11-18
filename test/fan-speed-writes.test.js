import assert from 'node:assert/strict'

import { afterEach, beforeEach, it, vi } from 'vitest'

import MerossFan from '../lib/device/fan.js'

function fixture(cachedSpeed = 0, cachedProps = { minValue: 0, maxValue: 100 }, context = {}) {
  const services = new Map()
  const accessory = {
    displayName: 'Test Fan',
    context: {
      connection: 'local',
      options: { hideLight: true },
      ...context,
    },
    getService: name => services.get(name),
    addService(type, name) {
      const characteristics = new Map()
      const service = {
        getCharacteristic(key) {
          if (!characteristics.has(key)) {
            characteristics.set(key, {
              value: key === 'RotationSpeed'
                ? cachedSpeed
                : false,
              props: { ...cachedProps, unit: 'percentage' },
              setProps(props) {
                Object.assign(this.props, props)
                return this
              },
              onSet(handler) {
                this.handler = handler
                return this
              },
            })
          }
          return characteristics.get(key)
        },
        updateCharacteristic: vi.fn((key, value) => {
          service.getCharacteristic(key).value = value
          return service
        }),
      }
      services.set(name, service)
      return service
    },
    log: vi.fn(),
    logWarn: vi.fn(),
    logDebug: vi.fn(),
    logDebugWarn: vi.fn(),
  }
  const platform = {
    api: {
      hap: {
        Characteristic: { On: 'On', RotationSpeed: 'RotationSpeed' },
        Service: { Fan: 'Fan', Lightbulb: 'Lightbulb' },
        HapStatusError: Error,
      },
    },
    config: {},
    log: vi.fn(),
    sendUpdate: vi.fn().mockResolvedValue({
      data: { payload: {} },
    }),
    updateAccessory: vi.fn(),
  }
  const fan = new MerossFan(platform, accessory)
  // Polling is tested separately; these tests never contact a device.
  vi.clearAllTimers()
  const rotation = fan.fanService.getCharacteristic('RotationSpeed')
  const report = data => fan.receiveUpdate({
    payload: {
      fan: [
        { channel: 2, ...data },
      ],
    },
  })
  const setSpeed = async (value) => {
    const result = rotation.handler(value).then(() => null, error => error)
    await vi.advanceTimersByTimeAsync(300)
    const error = await result
    if (error) {
      throw error
    }
  }
  return {
    fan,
    accessory,
    platform,
    rotation,
    report,
    setSpeed,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('remembers the reported top speed in the accessory context', () => {
  const { accessory, report } = fixture()
  report({ maxSpeed: 3, speed: 1, onoff: 0 })
  assert.equal(accessory.context.maxSpeed, 3)
})

it('sets the remembered three-speed steps before the first report', () => {
  const { fan, rotation } = fixture(200 / 3, { minValue: 0, maxValue: 100, minStep: 100 / 3 }, { maxSpeed: 3 })
  assert.equal(rotation.props.minStep, 100 / 3)
  assert.equal(rotation.value, 200 / 3)
  assert.equal(fan.cacheFanSpeed, 2)
})

it('treats a small non-zero percentage as speed 1, not off, while on', async () => {
  const { fan, report, setSpeed, platform } = fixture()
  report({ maxSpeed: 3, speed: 2, onoff: 1 })
  await setSpeed(2)
  assert.deepEqual(platform.sendUpdate.mock.calls.map(call => call[1]), [
    {
      namespace: 'Appliance.Control.Fan',
      payload: {
        fan: [
          { speed: 1, channel: 2 },
        ],
      },
    },
  ])
  assert.equal(fan.cacheFanState, true)
})

it('powers on at speed 1 for a small percentage while off', async () => {
  const { fan, report, setSpeed, platform } = fixture()
  report({ maxSpeed: 3, speed: 3, onoff: 0 })
  await setSpeed(3)
  assert.deepEqual(platform.sendUpdate.mock.calls.map(call => call[1].payload), [
    {
      togglex: { onoff: 1, channel: 2 },
    },
    {
      fan: [
        { speed: 1, channel: 2 },
      ],
    },
  ])
  assert.equal(fan.cacheFanState, true)
})
