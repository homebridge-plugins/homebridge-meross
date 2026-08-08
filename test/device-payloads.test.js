import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { buildHandler } from './build-handlers.js'
import { payloads } from './payloads.js'

/**
 * What a handler does with a message a real device actually sent.
 *
 * The snapshot next door records what each handler builds. This records what it
 * then does with what arrives.
 */

describe('the presence sensor, on payloads from a real MS600', () => {
  const Handler = deviceTypes.deviceSensorPresence
  const name = 'deviceSensorPresence'

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const build = () => {
    const built = buildHandler(name, Handler)
    expect(built.error).toBeUndefined()
    return built
  }

  it('reads the light level in lux (#582)', () => {
    const { device, accessory, cleanup } = build()

    device.receiveUpdate({ payload: payloads.ms600Lux.payload })

    expect(accessory.getService('LightSensor')
      .getCharacteristic('CurrentAmbientLightLevel').value).toBe(181)
    cleanup()
  })

  it('reads a light level of zero, which is what a dark room reports', () => {
    const { device, accessory, cleanup } = build()

    device.receiveUpdate({ payload: payloads.ms600Lux.payload })
    device.receiveUpdate({ payload: payloads.ms600LuxDark.payload })

    // Zero is a real reading, not a missing one. Skipped as falsy, the sensor
    // would sit at its last daylight value for as long as the room stayed dark.
    expect(accessory.getService('LightSensor')
      .getCharacteristic('CurrentAmbientLightLevel').value).toBe(0)
    cleanup()
  })

  it('turns a presence value into occupancy, and absence back off (#582)', () => {
    const { device, accessory, cleanup } = build()

    device.receiveUpdate({ payload: payloads.ms600Presence.payload })
    expect(accessory.getService('OccupancySensor')
      .getCharacteristic('OccupancyDetected').value).toBe(1)

    device.receiveUpdate({ payload: payloads.ms600Absence.payload })
    expect(accessory.getService('OccupancySensor')
      .getCharacteristic('OccupancyDetected').value).toBe(0)
    cleanup()
  })

  it('keeps the incoming message out of the warning log', () => {
    const { device, accessory, cleanup } = build()

    device.receiveUpdate({ payload: payloads.ms600Presence.payload })

    // Every other handler logs this at debug. A presence sensor pushes one of
    // these every few seconds, and the full message carries the header's `sign`
    // - a value derived from the owner's device key - so at warn level it both
    // floods the log and puts that in it.
    expect(accessory.logWarn.calls).toHaveLength(0)
    cleanup()
  })

  it('ignores a message with nothing in it, rather than throwing', () => {
    const { device, cleanup } = build()

    expect(() => device.receiveUpdate({})).not.toThrow()
    expect(() => device.receiveUpdate({ payload: {} })).not.toThrow()
    cleanup()
  })
})
