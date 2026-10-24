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
