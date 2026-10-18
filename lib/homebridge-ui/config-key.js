import platformConsts from '../utils/constants.js'

/**
 * Which config array the settings page should put a device in, by its model.
 *
 * A model missing here cannot be added or hidden from the My Devices tab -
 * the page just reports it as unsupported, even though the plugin itself runs
 * it fine (#816).
 *
 * @param {string} model the device model, as the plugin stores it
 * @returns {string|null} the config array, or null when the model is unknown
 */
export function getDeviceConfigKey(model) {
  if (!model) {
    return null
  }
  const m = platformConsts.models
  if (m.switchSingle.includes(model)) {
    return 'singleDevices'
  }
  if (Object.hasOwn(m.switchMulti, model)) {
    return 'multiDevices'
  }
  if (m.lightDimmer.includes(model) || m.lightRGB.includes(model) || m.lightCCT.includes(model)) {
    return 'lightDevices'
  }
  if (m.fan.includes(model)) {
    return 'fanDevices'
  }
  if (m.diffuser.includes(model)) {
    return 'diffuserDevices'
  }
  if (m.purifier.includes(model)) {
    return 'purifierDevices'
  }
  if (m.humidifier.includes(model)) {
    return 'humidifierDevices'
  }
  if (m.thermostat.includes(model) || m.thermostatMts215.includes(model) || m.thermostatMts300.includes(model) || m.thermostatMts960.includes(model)) {
    return 'thermostatDevices'
  }
  if (m.garage.includes(model)) {
    return 'garageDevices'
  }
  if (m.roller.includes(model)) {
    return 'rollerDevices'
  }
  if (m.baby.includes(model)) {
    return 'babyDevices'
  }
  // A hub's config entry is where its sensors' settings live, including the
  // list of sensors to hide (#816)
  if (m.sensorPresence.includes(model) || m.hubMain.includes(model)) {
    return 'sensorDevices'
  }
  return null
}
