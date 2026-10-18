import PQueue from 'p-queue'
import { TimeoutError } from 'p-timeout'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import { isTimeoutError } from '../lib/utils/functions.js'
import platformLang from '../lib/utils/lang-en.js'
import { buildHandler } from './build-handlers.js'

/**
 * Each device handler sends its commands through a queue that gives up after
 * ten seconds. Since p-queue 10 the queue reports that as a DOMException named
 * TimeoutError rather than p-timeout's TimeoutError class, and it is an
 * EventTarget rather than an EventEmitter - so the old `instanceof` check and
 * the old `.on('idle')` listener both stopped working.
 */
describe('a command that runs out of time', () => {
  it('is recognised when the queue times it out', async () => {
    const queue = new PQueue({ timeout: 10, throwOnTimeout: true })
    const err = await queue.add(() => new Promise(resolve => setTimeout(resolve, 200))).catch(e => e)

    expect(isTimeoutError(err)).toBe(true)
  })

  it('is recognised when the connection times it out', () => {
    expect(isTimeoutError(new TimeoutError('slow'))).toBe(true)
  })

  it('is not confused with any other failure', () => {
    expect(isTimeoutError(new Error('the device said no'))).toBe(false)
    expect(isTimeoutError(undefined)).toBe(false)
  })
})

describe('a switch whose command gets no answer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('logs the plain timed out message, not a raw error', async () => {
    const { device, accessory, cleanup } = buildHandler('deviceSwitchSingle', deviceTypes.deviceSwitchSingle, {
      // the device never replies
      sendUpdate: () => new Promise(() => {}),
    })

    const result = device.internalStateUpdate(true).catch(e => e)
    await vi.advanceTimersByTimeAsync(10_000)
    await result

    expect(accessory.logWarn.messages()).toEqual([`${platformLang.sendFailed} ${platformLang.timeout}`])
    cleanup()
  })

  it('lets polling resume once the queue has emptied', async () => {
    const { device, cleanup } = buildHandler('deviceSwitchSingle', deviceTypes.deviceSwitchSingle)

    await device.internalStateUpdate(true)
    await device.queue.onIdle()

    // set while the command was in flight, cleared by the queue's idle listener
    expect(device.updateInProgress).toBe(false)
    cleanup()
  })
})
