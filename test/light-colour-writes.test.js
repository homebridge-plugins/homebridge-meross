import assert from 'node:assert/strict'

import { afterEach, beforeEach, it, vi } from 'vitest'

import MerossLightRgb from '../lib/device/light-rgb.js'
import { makeAccessory, makePlatform } from './harness.js'

let light
let platform

beforeEach(() => {
  vi.useFakeTimers()
  platform = makePlatform()
  const accessory = makeAccessory('Test Bulb', {
    options: { adaptiveLightingShift: -1 },
  })
  light = new MerossLightRgb(platform, accessory)
  // Polling is not part of these tests, and no device is ever contacted
  vi.clearAllTimers()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Writes several characteristics the way HAP-NodeJS does for one HomeKit
 * request: every set handler starts at once, and a characteristic only takes
 * its new value once its own handler has finished.
 */
async function homeWrites(pairs) {
  await Promise.all(pairs.map(async ([name, value]) => {
    const characteristic = light.service.getCharacteristic(name)
    await characteristic.setHandler(value)
    characteristic.value = value
  }))
}

function colourCommands() {
  return platform.sent
    .filter(({ toSend }) => toSend.namespace === 'Appliance.Control.Light')
    .map(({ toSend }) => toSend.payload.light.rgb)
}

// Blue, hue 256 at 96% saturation
const blue = 4918015

// Warm orange, hue 25 at 96% saturation, as in the report (#831)
const orange = 16740362

it('sends the new colour once when home writes hue and saturation together (#831)', async () => {
  await homeWrites([
    ['Hue', 256],
    ['Saturation', 96],
  ])
  assert.deepEqual(colourCommands(), [blue])

  // A scene turning the light orange, with the saturation written again
  await homeWrites([
    ['Hue', 25],
    ['Saturation', 96],
  ])
  assert.deepEqual(colourCommands(), [blue, orange])
})

it('sends the new saturation when home writes both, saturation first', async () => {
  await homeWrites([
    ['Saturation', 50],
    ['Hue', 120],
  ])
  const sent = colourCommands()
  assert.equal(sent.length, 1)
  // Hue 120 at 50%: a pale green, red and blue at half of green
  assert.equal(sent[0], (128 << 16) + (255 << 8) + 128)
})

it('keeps the hue the light reported when home then changes only the saturation', async () => {
  await homeWrites([
    ['Hue', 256],
    ['Saturation', 96],
  ])

  // The light is turned pure red in the Meross app
  light.receiveUpdate({
    payload: {
      light: { rgb: 255 << 16, capacity: 1 },
    },
  })

  await homeWrites([
    ['Saturation', 50],
  ])
  const sent = colourCommands()
  assert.equal(sent.length, 2)
  // Red at 50%, not blue at 50%
  assert.equal(sent[1], (255 << 16) + (128 << 8) + 128)
})

it('still sends a change of saturation on its own', async () => {
  await homeWrites([
    ['Hue', 256],
    ['Saturation', 96],
  ])
  await homeWrites([
    ['Saturation', 40],
  ])
  const sent = colourCommands()
  assert.equal(sent.length, 2)
  assert.notEqual(sent[1], blue)
})
