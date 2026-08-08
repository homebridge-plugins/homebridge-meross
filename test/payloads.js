/**
 * Real device payloads, taken from what owners pasted into closed issues.
 *
 * Invented fixtures agree with whatever the code already assumes, so they only
 * ever confirm the current reading of a device. These came off real hardware.
 *
 * Only the `payload` half of each MQTT message is kept. The `header` carries a
 * device id, a message id and a `sign` derived from the owner's device key, and
 * none of it changes how a payload is parsed - one reporter left a real device
 * id in theirs, which is reason enough not to keep any of them.
 *
 * Each entry names the issue it came from, so the device behind it can be
 * checked again later.
 */

export const payloads = {
  /**
   * Meross MS600 presence sensor, namespace Appliance.Control.Sensor.LatestX.
   *
   * Issue #582. It reports a light level in lux and a presence value, either on
   * its own or together, and pushes one of these every few seconds.
   */
  ms600Lux: {
    issue: 582,
    payload: { latest: [{ channel: 0, data: { light: [{ timestamp: 1721487553, value: 181 }] } }] },
  },
  ms600LuxDark: {
    issue: 582,
    // The same shape with the light reading at zero, which is what a sensor in
    // a dark room sends
    payload: { latest: [{ channel: 0, data: { light: [{ timestamp: 1721487553, value: 0 }] } }] },
  },
  /** presence value 2 is 'presence', 1 is 'absence' - see value2Label */
  ms600Presence: {
    issue: 582,
    payload: {
      latest: [{
        channel: 0,
        data: { presence: [{ distance: 3060, times: 951, timestamp: 1721487660, value: 2 }] },
      }],
    },
  },
  ms600Absence: {
    issue: 582,
    payload: {
      latest: [{
        channel: 0,
        data: { presence: [{ distance: 3060, times: 0, timestamp: 1721505618, value: 1 }] },
      }],
    },
  },
}
