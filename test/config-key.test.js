import { describe, expect, it } from 'vitest'

import { getDeviceConfigKey } from '../lib/homebridge-ui/config-key.js'
import platformConsts from '../lib/utils/constants.js'

/**
 * The My Devices tab adds and hides a device by writing to the config array
 * for its model. A model with no array cannot be added or hidden there - the
 * page just says it is unsupported, even though the plugin runs it fine. That
 * is what happened to every sensor on an MSH450 hub (#816).
 */
describe('the config array for each model', () => {
  // Sensors on a hub use their hub's entry, and the template list is empty
  const topLevel = Object.entries(platformConsts.models)
    .filter(([list]) => !['hubSub', 'template'].includes(list))
    .flatMap(([list, models]) => (Array.isArray(models)
      ? models
      : Object.keys(models)).map(model => [list, model]))

  it.each(topLevel)('has one for every %s model (%s)', (_list, model) => {
    expect(getDeviceConfigKey(model)).not.toBeNull()
  })

  it('puts a hub in the sensor devices, where its sensors can be hidden one by one', () => {
    expect(getDeviceConfigKey('MSH450')).toBe('sensorDevices')
  })

  it('puts the mss815 in-wall switch with the single switches (#813)', () => {
    expect(getDeviceConfigKey('MSS815')).toBe('singleDevices')
    expect(platformConsts.matterHardware.MSS815).toContain('9')
  })

  it('has none for a model it does not know', () => {
    expect(getDeviceConfigKey('NOPE1')).toBeNull()
    expect(getDeviceConfigKey(undefined)).toBeNull()
  })
})
