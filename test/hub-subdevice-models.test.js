import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import platformConsts from '../lib/utils/constants.js'

/**
 * A hub sub-device only reaches Homebridge if its model is in `hubSub` AND the
 * dispatch switch in platform.js has a case for it. Miss either half and the
 * owner gets a "device not supported" warning and no accessory — which is how
 * the MA151 was reported (#803).
 *
 * These two lists live a long way apart in the source, so this pins them
 * together rather than trusting they stay in step.
 */
const platformSource = readFileSync(
  fileURLToPath(new URL('../lib/platform.js', import.meta.url)),
  'utf8',
)

// The `case 'XXX':` labels inside the sub-device dispatch switch.
function dispatchedModels() {
  const start = platformSource.indexOf('switch (subdeviceObj.model)')
  expect(start).toBeGreaterThan(-1)
  const end = platformSource.indexOf('\n            }', start)
  const block = platformSource.slice(start, end)
  return [...block.matchAll(/case '([^']+)':/g)].map(m => m[1])
}

/**
 * Models declared supported but with no case in the dispatch switch.
 *
 * These fall through to `default`, which happens AFTER the accessory has been
 * added — so the owner would get an accessory with no services that never
 * receives an update. MS130/MS130H sat here until #803; the list is kept (and
 * asserted empty) so the next one cannot slip in unnoticed.
 */
const KNOWN_UNDISPATCHED = []

describe('hub sub-device models', () => {
  it('every supported model has a handler to dispatch to', () => {
    const dispatched = dispatchedModels()
    const missing = platformConsts.models.hubSub.filter(model => !dispatched.includes(model))
    expect(missing).toEqual(KNOWN_UNDISPATCHED)
  })

  it('every dispatched model is declared supported', () => {
    // The reverse gap is just as bad: a case nothing can ever reach, because
    // the supported-models check rejects it first.
    const undeclared = dispatchedModels().filter(model => !platformConsts.models.hubSub.includes(model))
    expect(undeclared).toEqual([])
  })

  it('includes the MA151 that pairs with the MSH450 hub (#803)', () => {
    expect(platformConsts.models.hubSub).toContain('MA151')
    expect(dispatchedModels()).toContain('MA151')
  })

  it('dispatches the MS130 temperature sensors (#803)', () => {
    // Listed as supported since before #803 but with no case, so an owner got
    // an accessory that did nothing at all.
    expect(dispatchedModels()).toContain('MS130')
    expect(dispatchedModels()).toContain('MS130H')
  })
})
