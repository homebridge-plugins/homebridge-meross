import assert from 'node:assert/strict'

import { it, vi } from 'vitest'

import MerossFan from '../lib/device/fan.js'
import MerossPlatform from '../lib/platform.js'
import { makeAccessory, makePlatform } from './harness.js'

function fixture({ name, displayName = 'Original Fan', disabled = false } = {}) {
  const log = vi.fn()
  log.warn = vi.fn()
  log.debug = vi.fn()

  const platform = Object.create(MerossPlatform.prototype)
  platform.log = log
  platform.config = { disableDeviceLogging: disabled }

  const accessory = {
    displayName,
    UUID: 'synthetic-uuid',
    context: {
      options: name === undefined ? {} : { name },
    },
  }

  platform.applyAccessoryLogging(accessory)
  return { platform, accessory, log }
}

it('uses configured names in normal, warning and debug logs', () => {
  const x = fixture({ name: 'Ventilador Recámara' })

  x.accessory.log('turned on')
  x.accessory.logWarn('connection lost')
  x.accessory.logDebug('refresh complete')

  assert.deepEqual(x.log.mock.calls[0], [
    '[%s] %s.',
    'Ventilador Recámara',
    'turned on',
  ])
  assert.deepEqual(x.log.warn.mock.calls[0], [
    '[%s] %s.',
    'Ventilador Recámara',
    'connection lost',
  ])
  assert.deepEqual(x.log.debug.mock.calls[0], [
    '[%s] %s.',
    'Ventilador Recámara',
    'refresh complete',
  ])
})

it('uses the existing accessory name when no label is configured', () => {
  const x = fixture()
  x.accessory.log('ready')

  assert.equal(x.accessory.logName, 'Original Fan')
  assert.equal(x.log.mock.calls[0][1], 'Original Fan')
})

it('trims a custom label without changing HomeKit identity', () => {
  const x = fixture({ name: '  Ventilador Terraza  ' })
  x.accessory.log('ready')

  assert.equal(x.accessory.logName, 'Ventilador Terraza')
  assert.equal(x.accessory.displayName, 'Original Fan')
  assert.equal(x.accessory.UUID, 'synthetic-uuid')
  assert.equal(x.accessory.context.options.name, '  Ventilador Terraza  ')
})

it('ignores empty and invalid configured names', () => {
  for (const name of ['', '  ', 42, null]) {
    const x = fixture({ name })
    x.accessory.log('ready')
    assert.equal(x.log.mock.calls[0][1], 'Original Fan')
  }
})

it('preserves disabled logging behavior but allows debug', () => {
  const x = fixture({ name: 'Oficina', disabled: true })

  x.accessory.log('normal')
  x.accessory.logWarn('warning')
  x.accessory.logDebug('debug')

  assert.equal(x.log.mock.calls.length, 0)
  assert.equal(x.log.warn.mock.calls.length, 0)
  assert.equal(x.log.debug.mock.calls.length, 1)
  assert.equal(x.log.debug.mock.calls[0][1], 'Oficina')
})

it('logs fan initialization with its configured label', () => {
  vi.useFakeTimers()
  let fan
  try {
    const platform = makePlatform()
    const accessory = makeAccessory('Original Fan', {
      options: { name: 'Ventilador Recámara' },
    })

    MerossPlatform.prototype.applyAccessoryLogging.call(
      platform,
      accessory,
    )
    fan = new MerossFan(platform, accessory)

    assert.equal(fan.name, 'Ventilador Recámara')
    assert.equal(accessory.displayName, 'Original Fan')
    assert.equal(platform.log.entries.at(-1).args[0], '[%s] %s %s.')
    assert.equal(platform.log.entries.at(-1).args[1], 'Ventilador Recámara')
    assert.equal(accessory.mqtt, undefined)
    assert.equal(platform.sent.length, 0)
  } finally {
    if (fan) {
      clearInterval(fan.accessory.refreshInterval)
    }
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

it('preserves original fan name when no custom label exists', () => {
  vi.useFakeTimers()
  let fan
  try {
    const platform = makePlatform()
    const accessory = makeAccessory('Original Fan')

    MerossPlatform.prototype.applyAccessoryLogging.call(
      platform,
      accessory,
    )
    fan = new MerossFan(platform, accessory)

    assert.equal(fan.name, 'Original Fan')
    assert.equal(accessory.displayName, 'Original Fan')
    assert.equal(platform.sent.length, 0)
  } finally {
    if (fan) {
      clearInterval(fan.accessory.refreshInterval)
    }
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

it('refreshes the log label on rediscovery without renaming HomeKit', () => {
  const platform = makePlatform()
  const accessory = makeAccessory('Original Fan', {
    options: { name: 'Primer nombre' },
  })
  const uuid = accessory.UUID

  MerossPlatform.prototype.applyAccessoryLogging.call(
    platform,
    accessory,
  )
  accessory.log('first')

  accessory.context.options = { name: 'Nombre actualizado' }
  MerossPlatform.prototype.applyAccessoryLogging.call(
    platform,
    accessory,
  )
  accessory.log('second')

  const logs = platform.log.entries.filter(entry =>
    entry.level === 'info')
  assert.deepEqual(logs.map(entry => entry.args[1]), [
    'Primer nombre',
    'Nombre actualizado',
  ])
  assert.equal(accessory.displayName, 'Original Fan')
  assert.equal(accessory.UUID, uuid)
})
