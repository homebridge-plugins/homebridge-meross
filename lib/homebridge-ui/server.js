import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils'

import platformConsts from '../utils/constants.js'

function getDeviceConfigKey(model) {
  if (!model) {
    return null
  }
  const m = platformConsts.models
  if (m.switchSingle.includes(model)) {
    return 'singleDevices'
  }
  if (Object.prototype.hasOwnProperty.call(m.switchMulti, model)) {
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
  if (m.thermostat.includes(model)) {
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
  if (m.sensorPresence.includes(model)) {
    return 'sensorDevices'
  }
  return null
}

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()
    this.onRequest('/getDeviceConfigKey', ({ model }) => getDeviceConfigKey(model))
    this.ready()
  }
}

(() => new PluginUiServer())()
