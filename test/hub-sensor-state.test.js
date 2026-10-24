import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * A hub reports every sensor paired to it in one status reply, and pushes
 * changes for them as they happen. The hub's handler has to pick out each
 * sensor's fields and pass them on, so a sensor whose fields it does not know
 * gets an accessory in HomeKit that never changes.
 */

const HUB_SERIAL = '000000000000000000000000abcdef01'

/**
 * Builds a hub plus one sensor on it, the way platform.js does.
 *
 * @param {string} handler the sensor's handler name
 * @param {string} id the sensor's id on the hub
 * @param {object} poll the payload the hub answers a status request with
 * @returns {object} the hub and sensor handlers, and the sensor accessory
 */
function hubWith(handler, id, poll = {}) {
  const platform = makePlatform({
    sendUpdate: async () => ({
      data: { payload: poll },
    }),
  })
  const hubAcc = makeAccessory('Hub', { serialNumber: HUB_SERIAL, model: 'MSH300' })
  const hub = new deviceTypes.deviceHubMain(platform, hubAcc)

  const subAcc = makeAccessory('Sensor', { serialNumber: HUB_SERIAL, subSerialNumber: id })
  subAcc.control = new deviceTypes[handler](platform, subAcc)
  platform.devicesInHB.set(platform.api.hap.uuid.generate(HUB_SERIAL + id), subAcc)

  return {
    hub,
    subAcc,
    cleanup: () => clearInterval(hubAcc.refreshInterval),
  }
}

// A status reply with a single sensor in the hub's list
function digestWith(subdevice) {
  return {
    all: {
      system: {
        online: { status: 1 },
      },
      digest: {
        hub: {
          subdevice: [subdevice],
        },
      },
    },
  }
}

// A pushed update from the hub, for one sensor
function pushOf(key, entry) {
  return {
    payload: {
      [key]: [entry],
    },
  }
}

function charValue(accessory, service, char) {
  return accessory.getService(service).getCharacteristic(char).value
}

describe('a hub door and window sensor (MS200)', () => {
  let built

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    built?.cleanup()
    vi.useRealTimers()
  })

  it('shows as open when the hub status says so', async () => {
    built = hubWith('deviceHubContact', '0201', digestWith({
      id: '0201',
      status: 1,
      doorWindow: { status: 1, lmTime: 1700000000 },
    }))
    await built.hub.requestUpdate()
    expect(charValue(built.subAcc, 'ContactSensor', 'ContactSensorState')).toBe(1)
  })

  it('follows a pushed change from open to closed', () => {
    built = hubWith('deviceHubContact', '0201')
    built.hub.receiveUpdate(pushOf('doorWindow', { id: '0201', status: 1, lmTime: 1700000000 }))
    expect(charValue(built.subAcc, 'ContactSensor', 'ContactSensorState')).toBe(1)
    built.hub.receiveUpdate(pushOf('doorWindow', { id: '0201', status: 0, lmTime: 1700000060 }))
    expect(charValue(built.subAcc, 'ContactSensor', 'ContactSensorState')).toBe(0)
  })
})

describe('a hub smoke alarm (GS559A, MA151)', () => {
  let built

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    built?.cleanup()
    vi.useRealTimers()
  })

  it('reads all clear from the hub status', async () => {
    built = hubWith('deviceHubSmoke', '0301', digestWith({
      id: '0301',
      status: 1,
      smokeAlarm: { status: 170, interConn: 0 },
    }))
    await built.hub.requestUpdate()
    expect(charValue(built.subAcc, 'SmokeSensor', 'SmokeDetected')).toBe(0)
    expect(charValue(built.subAcc, 'SmokeSensor', 'StatusFault')).toBe(0)
    expect(built.subAcc.getService('SmokeSensor').isPrimary).toBe(true)
  })

  it.each([
    ['smoke', 25],
    ['muted smoke', 27],
    ['heat', 24],
    ['a test press', 23],
  ])('shows smoke detected for %s (%s)', (_label, status) => {
    built = hubWith('deviceHubSmoke', '0301')
    built.hub.receiveUpdate(pushOf('smokeAlarm', { id: '0301', status, interConn: 0 }))
    expect(charValue(built.subAcc, 'SmokeSensor', 'SmokeDetected')).toBe(1)
  })

  it('clears once the alarm is over', () => {
    built = hubWith('deviceHubSmoke', '0301')
    built.hub.receiveUpdate(pushOf('smokeAlarm', { id: '0301', status: 25, interConn: 0 }))
    built.hub.receiveUpdate(pushOf('smokeAlarm', { id: '0301', status: 170, interConn: 0 }))
    expect(charValue(built.subAcc, 'SmokeSensor', 'SmokeDetected')).toBe(0)
  })

  it('shows a fault, not smoke, when the sensor reports a problem', () => {
    built = hubWith('deviceHubSmoke', '0301')
    built.hub.receiveUpdate(pushOf('smokeAlarm', { id: '0301', status: 19, interConn: 0 }))
    expect(charValue(built.subAcc, 'SmokeSensor', 'SmokeDetected')).toBe(0)
    expect(charValue(built.subAcc, 'SmokeSensor', 'StatusFault')).toBe(1)
  })

  it('leaves the state alone for a code it does not know', () => {
    built = hubWith('deviceHubSmoke', '0301')
    built.hub.receiveUpdate(pushOf('smokeAlarm', { id: '0301', status: 25, interConn: 0 }))
    built.hub.receiveUpdate(pushOf('smokeAlarm', { id: '0301', status: 99, interConn: 0 }))
    expect(charValue(built.subAcc, 'SmokeSensor', 'SmokeDetected')).toBe(1)
    expect(built.subAcc.logWarn.messages().join()).toContain('99')
  })
})

describe('a hub MS130 temperature and humidity sensor', () => {
  let built

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    built?.cleanup()
    vi.useRealTimers()
  })

  // The MS130 sends hundredths of a degree and tenths of a percent
  it('reads its temperature and humidity from the hub status', async () => {
    built = hubWith('deviceHubSensor', '0401', digestWith({
      id: '0401',
      status: 1,
      onoff: 1,
      tempHumi: { latestTime: 1700000000, temp: 2148, humi: 563 },
    }))
    await built.hub.requestUpdate()
    expect(charValue(built.subAcc, 'TemperatureSensor', 'CurrentTemperature')).toBe(21.5)
    expect(charValue(built.subAcc, 'HumiditySensor', 'CurrentRelativeHumidity')).toBe(56)
  })

  it('follows a pushed reading', () => {
    built = hubWith('deviceHubSensor', '0401')
    built.hub.receiveUpdate(pushOf('latest', {
      subId: '0401',
      channel: 0,
      data: {
        temp: [
          { value: 1932, timestamp: 1700000000 },
        ],
        humi: [
          { value: 618, timestamp: 1700000000 },
        ],
        light: [
          { value: 120, timestamp: 1700000000 },
        ],
      },
    }))
    expect(charValue(built.subAcc, 'TemperatureSensor', 'CurrentTemperature')).toBe(19.3)
    expect(charValue(built.subAcc, 'HumiditySensor', 'CurrentRelativeHumidity')).toBe(62)
  })
})

describe('a hub sensor\'s battery', () => {
  let built

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    built?.cleanup()
    vi.useRealTimers()
  })

  // These sensors report no voltage, so the hub's own figure is all there is
  it.each([
    ['deviceHubContact'],
    ['deviceHubSmoke'],
    ['deviceHubSensor'],
  ])('takes the percentage the hub pushes for %s', (handler) => {
    built = hubWith(handler, '0501')
    built.hub.receiveUpdate(pushOf('battery', { id: '0501', value: 15 }))
    expect(charValue(built.subAcc, 'Battery', 'BatteryLevel')).toBe(15)
    expect(charValue(built.subAcc, 'Battery', 'StatusLowBattery')).toBe(1)
  })

  it('keeps the hub\'s figure over the estimate from a later voltage reading', () => {
    built = hubWith('deviceHubSensor', '0501')
    built.hub.receiveUpdate(pushOf('battery', { id: '0501', value: 80 }))
    built.subAcc.control.applyUpdate({ voltage: 2500 })
    expect(charValue(built.subAcc, 'Battery', 'BatteryLevel')).toBe(80)
  })

  it('does not pass a battery reading to a sensor with no battery tile', () => {
    built = hubWith('deviceHubLeak', '0501')
    built.hub.receiveUpdate(pushOf('battery', { id: '0501', value: 80 }))
    expect(built.subAcc.logWarn.calls).toEqual([])
  })
})
