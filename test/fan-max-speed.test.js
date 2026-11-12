import assert from 'node:assert/strict'

import { afterEach, beforeEach, it, vi } from 'vitest'

import MerossFan from '../lib/device/fan.js'

function fixture(cachedSpeed = 0) {
  const services = new Map()
  const accessory = {
    displayName: 'Test Fan',
    context: {
      connection: 'local',
      options: { hideLight: true },
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
              props: { minValue: 0, maxValue: 100, unit: 'percentage' },
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

it('preserves the four-speed percentage fallback without sending commands', () => {
  const { rotation, platform } = fixture()
  assert.deepEqual(rotation.props, {
    minValue: 0,
    maxValue: 100,
    unit: 'percentage',
    minStep: 25,
    validValues: null,
  })
  assert.equal(platform.sendUpdate.mock.calls.length, 0)
})

it.each([
  [
    3,
    [0, 100 / 3, 200 / 3, 100],
    100 / 3,
  ],
  [
    4,
    [0, 25, 50, 75, 100],
    25,
  ],
])('uses percentage properties and round trips each level for maxSpeed=%i', (maximum, values, step) => {
  const { fan, rotation, report, platform } = fixture()
  report({ maxSpeed: maximum, speed: 1 })
  assert.equal(rotation.props.minValue, 0)
  assert.equal(rotation.props.maxValue, 100)
  assert.equal(rotation.props.unit, 'percentage')
  assert.equal(rotation.props.minStep, step)
  assert.equal(rotation.props.validValues, null)
  for (const [level, percentage] of values.entries()) {
    assert.equal(fan.mr2hk(level), percentage)
    assert.equal(fan.hk2mr(percentage), level)
  }
  for (let value = 0; value <= 100; value++) {
    assert.ok(fan.hk2mr(value) >= 0 && fan.hk2mr(value) <= maximum)
  }
  assert.equal(platform.sendUpdate.mock.calls.length, 0)
})

it.each([
  [3, 33, 1],
  [3, 66, 2],
  [3, 100, 3],
  [3, 50, 2],
  [4, 25, 1],
  [4, 50, 2],
  [4, 75, 3],
  [4, 100, 4],
])('sends the physical level for maxSpeed=%i and HomeKit=%i%%', async (maximum, value, expected) => {
  const { report, setSpeed, platform, accessory } = fixture()
  report({ maxSpeed: maximum, speed: 0 })
  await setSpeed(value)
  assert.deepEqual(platform.sendUpdate.mock.calls, [
    [
      accessory,
      {
        namespace: 'Appliance.Control.Fan',
        payload: {
          fan: [
            { speed: expected, channel: 2 },
          ],
        },
      },
    ],
  ])
  assert.equal(accessory.logWarn.mock.calls.length, 0)
})

it('re-publishes an unchanged physical speed when maxSpeed changes', () => {
  const { report, rotation, platform } = fixture(50)
  report({ maxSpeed: 3, speed: 2 })
  assert.equal(rotation.value, 200 / 3)
  report({ speed: 3 })
  assert.equal(rotation.value, 100)
  report({ maxSpeed: 4, speed: 3 })
  assert.equal(rotation.value, 75)
  assert.equal(platform.sendUpdate.mock.calls.length, 0)
})

it('applies a maxSpeed-only report to the remembered physical level', () => {
  const { report, rotation } = fixture(50)
  report({ maxSpeed: 3 })
  assert.equal(rotation.value, 200 / 3)
})

it.each([undefined, null, 0, -1, 2, 5, 3.5, '3'])('ignores unsupported maxSpeed=%s and keeps the last valid maximum', (maximum) => {
  const { fan, report, rotation, platform } = fixture()
  report({ maxSpeed: 3, speed: 1 })
  report({ maxSpeed: maximum, speed: 2 })
  assert.equal(fan.hk2mr(100), 3)
  assert.equal(rotation.value, 200 / 3)
  assert.equal(rotation.props.validValues, null)
  assert.equal(platform.sendUpdate.mock.calls.length, 0)
})

it.each([-1, 4, 1.5, '2', null])('ignores invalid reported speed=%s on a three-speed fan', (speed) => {
  const { report, rotation, platform } = fixture()
  report({ maxSpeed: 3, speed: 2 })
  report({ speed })
  assert.equal(rotation.value, 200 / 3)
  assert.equal(platform.sendUpdate.mock.calls.length, 0)
})

it('retains power-off state when a remembered nonzero speed is reported', () => {
  const { fan, report, platform } = fixture()
  report({ maxSpeed: 3, speed: 2, onoff: 0 })
  assert.equal(fan.cacheFanState, false)
  assert.equal(fan.cacheFanSpeed, 2)
  assert.equal(platform.sendUpdate.mock.calls.length, 0)
})

it('preserves the existing slider-off command and remembered speed', async () => {
  const { fan, report, setSpeed, platform, rotation } = fixture()
  report({ maxSpeed: 3, speed: 2, onoff: 1 })
  await setSpeed(0)
  assert.equal(platform.sendUpdate.mock.calls[0][1].payload.fan[0].speed, 0)
  assert.equal(fan.cacheFanSpeed, 2)
  await vi.advanceTimersByTimeAsync(2000)
  assert.equal(rotation.value, 200 / 3)
})

it('does not send a redundant command at the current speed', async () => {
  const { report, setSpeed, platform } = fixture()
  report({ maxSpeed: 3, speed: 2 })
  await setSpeed(66)
  assert.equal(platform.sendUpdate.mock.calls.length, 0)
})

it('reconciles a client percentage when the reported physical level has not changed', async () => {
  const { report, setSpeed, platform, rotation } = fixture()
  report({ maxSpeed: 3, speed: 1 })
  await setSpeed(50)
  // HAP stores the original client value after the set handler resolves.
  rotation.value = 50
  report({ speed: 2 })
  assert.equal(rotation.value, 200 / 3)
  assert.equal(platform.sendUpdate.mock.calls.length, 1)
})

it('restores the percentage after a failed speed command', async () => {
  const { report, setSpeed, platform, rotation } = fixture()
  report({ maxSpeed: 3, speed: 2 })
  platform.sendUpdate.mockRejectedValueOnce(new Error('simulated failure'))
  const failed = assert.rejects(setSpeed(100))
  await failed
  await vi.advanceTimersByTimeAsync(2000)
  assert.equal(rotation.value, 200 / 3)
})

it('learns maxSpeed from the initial System.All poll', async () => {
  const { fan, platform, rotation } = fixture()
  platform.sendUpdate.mockResolvedValueOnce({
    data: {
      payload: {
        all: {
          digest: {
            fan: [
              { channel: 2, maxSpeed: 3, speed: 3 },
            ],
          },
          system: {},
        },
      },
    },
  })
  await fan.requestUpdate(true)
  assert.equal(rotation.props.validValues, null)
  assert.equal(rotation.value, 100)
})
