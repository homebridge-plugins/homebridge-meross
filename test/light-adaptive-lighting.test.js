import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { hk2mrCT } from '../lib/utils/colour.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * The first report after a restart, when adaptive lighting ran while the light
 * was off.
 *
 * Adaptive lighting keeps moving HomeKit's saved colour temperature while the
 * light is off, but nothing is sent to a light that is off. So by the restart
 * HomeKit's value is somewhere the light never went, and comparing the light's
 * first report against it switched adaptive lighting off. What was actually
 * last sent is what counts.
 */

describe.each([
  ['deviceLightCCT', 2],
  ['deviceLightRGB', 6],
])('the %s light, restarted after adaptive lighting ran while it was off', (name, capacity) => {
  const Handler = deviceTypes[name]

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const mockController = () => ({
    isAdaptiveLightingActive: () => true,
    disableAdaptiveLighting: vi.fn(),
  })

  // Send a colour temperature with the light on, turn it off, let adaptive
  // lighting move on to a cooler one, then boot again on the same accessory,
  // the way Homebridge restores it from its cache
  async function restartAfterAdaptiveLightingMovedOn() {
    const platform = makePlatform()
    const accessory = makeAccessory(name)
    const before = new Handler(platform, accessory)
    before.alController = mockController()
    before.cacheState = true
    const first = before.internalCTUpdate(370)
    await vi.advanceTimersByTimeAsync(1000)
    await first

    before.cacheState = false
    before.service.updateCharacteristic('ColorTemperature', 250)
    const second = before.internalCTUpdate(250)
    await vi.advanceTimersByTimeAsync(1000)
    await second
    clearInterval(accessory.refreshInterval)

    const device = new Handler(platform, accessory)
    device.alController = mockController()
    return { device, accessory }
  }

  it('leaves adaptive lighting on when the light reports the colour temperature it was last sent', async () => {
    const { device, accessory } = await restartAfterAdaptiveLightingMovedOn()

    device.applyUpdate({
      light: {
        temperature: hk2mrCT(370),
        capacity,
      },
    })

    expect(device.alController.disableAdaptiveLighting).not.toHaveBeenCalled()
    clearInterval(accessory.refreshInterval)
  })

  it('still switches it off when the colour temperature was changed while homebridge was down', async () => {
    const { device, accessory } = await restartAfterAdaptiveLightingMovedOn()

    device.applyUpdate({
      light: {
        temperature: hk2mrCT(160),
        capacity,
      },
    })

    expect(device.alController.disableAdaptiveLighting).toHaveBeenCalledTimes(1)
    clearInterval(accessory.refreshInterval)
  })
})
