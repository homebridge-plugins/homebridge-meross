import { describe, expect, it, vi } from 'vitest'

import Platform from '../lib/platform.js'
import EveChars, { currentConsumptionUUID } from '../lib/utils/eve-chars.js'

/**
 * Eve's Current Consumption was a whole number, so HomeKit rounded 5.49 W down
 * to 5 W. It is now a decimal. Homebridge restores a cached accessory with the
 * props it was saved with, so existing accessories are converted on restore.
 */

const Formats = { FLOAT: 'float', UINT16: 'uint16', UINT32: 'uint32', UINT8: 'uint8', BOOL: 'bool' }
const Perms = { PAIRED_READ: 'pr', PAIRED_WRITE: 'pw', NOTIFY: 'ev' }

// Just enough of a HAP characteristic: a UUID and props that setProps merges into
class FakeCharacteristic {
  constructor(displayName, UUID, props = {}) {
    this.displayName = displayName
    this.UUID = UUID
    this.props = { ...props }
  }

  setProps(props) {
    Object.assign(this.props, props)
    return this
  }

  getDefaultValue() {
    return 0
  }
}

function makeApi() {
  return {
    versionGreaterOrEqual: () => true,
    serverVersion: '2.0.0',
    on: vi.fn(),
    hap: { HAPLibraryVersion: () => '1.0.0', Characteristic: FakeCharacteristic, Formats, Perms },
  }
}

function makeLog() {
  const log = vi.fn()
  log.warn = vi.fn()
  log.debug = vi.fn()
  return log
}

describe('eve current consumption', () => {
  it('is declared as a decimal, so HomeKit keeps a fraction of a watt', () => {
    const eveChars = new EveChars(makeApi())
    const characteristic = new eveChars.CurrentConsumption()

    expect(characteristic.UUID).toBe(currentConsumptionUUID)
    expect(characteristic.props).toMatchObject({
      format: Formats.FLOAT,
      minStep: 0.01,
      unit: 'W',
      minValue: 0,
      maxValue: 100000,
      perms: [Perms.PAIRED_READ, Perms.NOTIFY],
    })
  })

  it('is converted on an accessory restored from the cache', () => {
    const platform = new Platform(makeLog(), { platform: 'Meross' }, makeApi())

    // As cached by an older version of the plugin
    const cachedProps = {
      format: Formats.UINT16,
      unit: 'W',
      maxValue: 100000,
      minValue: 0,
      minStep: 1,
      perms: [Perms.PAIRED_READ, Perms.NOTIFY],
    }
    const consumption = new FakeCharacteristic('Current Consumption', currentConsumptionUUID, cachedProps)
    const other = new FakeCharacteristic('On', '00000025-0000-1000-8000-0026BB765291', {
      format: Formats.BOOL,
    })
    const accessory = {
      UUID: 'uuid-outlet',
      displayName: 'Outlet',
      context: {},
      services: [{ characteristics: [other, consumption] }],
    }

    platform.configureAccessory(accessory)

    expect(consumption.props).toEqual({ ...cachedProps, format: Formats.FLOAT, minStep: 0.01 })
    expect(other.props).toEqual({ format: Formats.BOOL })
    expect(platform.devicesInHB.get('uuid-outlet')).toBe(accessory)
  })
})
