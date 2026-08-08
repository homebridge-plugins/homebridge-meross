import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildHandler, everyHandler } from './build-handlers.js'

/**
 * A record of what every device handler builds: which HomeKit services it adds,
 * and which characteristics sit on those services.
 *
 * This exists so that a refactor can be shown to have changed nothing. Almost
 * four hundred blocks of this plugin are duplicated across the device files,
 * and collapsing them is the obvious next move. The failure that guards against
 * is silent: a device quietly loses a characteristic, nobody notices, and it
 * surfaces as an issue weeks later.
 *
 * Any diff here must be explained before it is accepted.
 * Run `npx vitest -u` to accept an intended change.
 */

// Homebridge adds this one itself with the same contents for every accessory,
// so recording it would be pages of identical noise
const IGNORED_SERVICE = 'AccessoryInformation'

function describeHandler(name, Handler) {
  const { device: built, accessory, error, cleanup } = buildHandler(name, Handler)
  try {
    if (error) {
      return `${name}\n  did not build: ${error}\n`
    }

    const lines = [name]
    if (built?.pollInterval !== undefined) {
      lines.push(`  polls every: ${built.pollInterval}s`)
    }

    const services = accessory.services
      .filter(service => service.type !== IGNORED_SERVICE)
      .sort((a, b) => `${a.type}${a.subtype ?? ''}`.localeCompare(`${b.type}${b.subtype ?? ''}`))

    services.forEach((service) => {
      const subtype = service.subtype ? ` [${service.subtype}]` : ''
      lines.push(`  service: ${service.type}${subtype}${service.isPrimary ? ' *primary' : ''}`)
      ;[...service.characteristics.keys()].sort().forEach((char) => {
        const props = service.characteristics.get(char).props
        const shown = Object.keys(props).length > 0
          ? `  [${Object.entries(props).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}]`
          : ''
        lines.push(`    ${char}${shown}`)
      })
    })

    return `${lines.join('\n')}\n`
  } finally {
    cleanup()
  }
}

describe('the device handlers', () => {
  // Every handler starts a polling timer and a couple of delayed setup calls in
  // its constructor. Under real timers those would fire mid-test and try to
  // reach a device that is not there.
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('build the same services and characteristics as before', async () => {
    const snapshot = everyHandler()
      .map(([name, Handler]) => describeHandler(name, Handler))
      .join('\n')

    await expect(snapshot).toMatchFileSnapshot('./device-snapshot.txt')
  })

  it('covers every handler the plugin exports', () => {
    // A guard on the guard: if the export shape changes and the walk above
    // stops finding them, the snapshot would silently shrink to nothing
    expect(everyHandler().length).toBeGreaterThan(30)
  })

  it('opens no connection for a local accessory', () => {
    const [name, Handler] = everyHandler()[0]
    const { accessory, cleanup } = buildHandler(name, Handler)

    // A cloud accessory makes its handler connect over MQTT in the constructor.
    // The harness defaults to local so that never happens - if that default is
    // lost, every test in this file starts talking to the network.
    expect(accessory.mqtt).toBeUndefined()
    cleanup()
  })
})
