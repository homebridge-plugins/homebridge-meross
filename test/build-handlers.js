/**
 * Building every device handler, in one place.
 *
 * Each handler's setup needs are a property of the handler rather than of any
 * one test, so they live here.
 */

import deviceTypes from '../lib/device/index.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * Context a particular handler reads during setup.
 *
 * A handler left out here gets the harness defaults, which are the shape of an
 * ordinary single-channel local switch.
 */
export const CONTEXT_FOR = {
  deviceOutletMulti: { channel: 1, options: { hideChannels: '' } },
  deviceSwitchMulti: { channel: 1, options: { hideChannels: '' } },
  devicePowerStrip: { channel: 1, options: { hideChannels: '' } },
  deviceGarageSub: { channel: 1 },
  deviceHubSensor: { subdeviceId: '0100' },
  deviceHubContact: { subdeviceId: '0100' },
  deviceHubLeak: { subdeviceId: '0100' },
  deviceHubSmoke: { subdeviceId: '0100' },
  deviceHubValve: { subdeviceId: '0100' },
  deviceHubSprinkler: { subdeviceId: '0100' },
}

/**
 * Handlers that take more than `(platform, accessory)`.
 *
 * The baby monitor publishes its light as a second accessory and decorates it
 * in the constructor, so that accessory is a real argument rather than
 * something the harness can stand in for.
 */
export const EXTRA_ARGS_FOR = {
  deviceBaby: () => [makeAccessory('Baby Monitor Light')],
}

/**
 * Every handler the plugin exports, sorted so a failure names something
 * findable.
 */
export function everyHandler() {
  return Object.entries(deviceTypes)
    .filter(([, value]) => typeof value === 'function')
    .sort(([a], [b]) => a.localeCompare(b))
}

/**
 * Builds one handler with the platform and accessory it needs.
 *
 * Returns the failure rather than throwing, so a caller checking all of them at
 * once can report every problem instead of stopping at the first.
 *
 * The polling interval a handler starts is cleared afterwards. Under fake
 * timers it would never fire anyway, but leaving thirty of them behind makes
 * the timer state meaningless for whatever runs next.
 */
export function buildHandler(name, Handler, platformOverrides = {}, contextOverrides = {}) {
  const platform = makePlatform(platformOverrides)
  const accessory = makeAccessory(name, { ...(CONTEXT_FOR[name] ?? {}), ...contextOverrides })

  const extra = EXTRA_ARGS_FOR[name]?.(platform, accessory) ?? []

  try {
    const device = new Handler(platform, accessory, ...extra)
    return { device, platform, accessory, cleanup: () => clearInterval(accessory.refreshInterval) }
  } catch (err) {
    return { error: err.message, platform, accessory, cleanup: () => clearInterval(accessory.refreshInterval) }
  }
}
