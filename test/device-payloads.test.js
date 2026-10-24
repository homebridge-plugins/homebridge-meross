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

/**
 * The MTS960 speaks a different thermostat message from the wall thermostats it
 * used to be grouped with - `modeB`, in hundredths of a degree, with 2 for off.
 * Read as one of those, nothing matched: the temperature sat at 0 and the heat
 * switch never moved (#809).
 */
describe('the mts960 plug-in thermostat, on payloads from a real device', () => {
  const Handler = deviceTypes.deviceThermostatMts960
  const name = 'deviceThermostatMts960'
  const thermostat = accessory => accessory.getService('Thermostat')
  const value = (accessory, char) => thermostat(accessory).getCharacteristic(char).value

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

  it('reads the temperature, the setpoint and heating (#809)', () => {
    const { device, accessory, cleanup } = build()

    device.receiveUpdate({ payload: payloads.mts960ScheduleHeating.payload })

    expect(value(accessory, 'CurrentTemperature')).toBe(17.23)
    expect(value(accessory, 'TargetTemperature')).toBe(18)
    expect(value(accessory, 'TargetHeatingCoolingState')).toBe(1)
    expect(value(accessory, 'CurrentHeatingCoolingState')).toBe(1)
    cleanup()
  })

  it('reads cooling with the relay idle, and keeps the setpoint a timer reports as 0', () => {
    const { device, accessory, cleanup } = build()

    device.receiveUpdate({ payload: payloads.mts960ScheduleHeating.payload })
    device.receiveUpdate({ payload: payloads.mts960TimerCoolingIdle.payload })

    expect(value(accessory, 'CurrentTemperature')).toBe(19.36)
    expect(value(accessory, 'TargetHeatingCoolingState')).toBe(2)
    expect(value(accessory, 'CurrentHeatingCoolingState')).toBe(0)
    expect(value(accessory, 'TargetTemperature')).toBe(18)
    cleanup()
  })

  it('sends off as 2, and a setpoint in hundredths of a degree', async () => {
    const { accessory, platform, cleanup } = build()

    const off = thermostat(accessory).getCharacteristic('TargetHeatingCoolingState').setHandler(1)
    await vi.advanceTimersByTimeAsync(1000)
    await off
    const target = thermostat(accessory).getCharacteristic('TargetTemperature').setHandler(21.5)
    await vi.advanceTimersByTimeAsync(1000)
    await target
    const turnOff = thermostat(accessory).getCharacteristic('TargetHeatingCoolingState').setHandler(0)
    await vi.advanceTimersByTimeAsync(1000)
    await turnOff

    // the startup status poll goes out in among these, so look at commands only
    const sent = platform.sent.map(s => s.toSend).filter(s => s.namespace !== 'Appliance.System.All')
    expect(sent.every(s => s.namespace === 'Appliance.Control.Thermostat.ModeB')).toBe(true)
    expect(sent.map(s => s.payload.modeB[0])).toEqual([
      {
        channel: 0,
        onoff: 1,
        mode: 1,
        working: 1,
      },
      {
        channel: 0,
        mode: 1,
        working: 1,
        targetTemp: 2150,
      },
      { channel: 0, onoff: 2 },
    ])
    cleanup()
  })
})
