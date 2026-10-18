import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils'

import { getDeviceConfigKey } from './config-key.js'

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()
    this.onRequest('/getDeviceConfigKey', ({ model }) => getDeviceConfigKey(model))
    this.ready()
  }
}

(() => new PluginUiServer())()
