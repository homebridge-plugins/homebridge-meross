import PQueue from 'p-queue'

import mqttClient from '../connection/mqtt.js'
import platformConsts from '../utils/constants.js'
import { hasProperty, isTimeoutError, parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

// The MTS960 plug-in thermostat speaks Appliance.Control.Thermostat.ModeB, not
// the .Mode the MTS200 uses. Its digest arrives as `thermostat.modeB`, its
// temperatures are hundredths of a degree, and it uses 1 for on and 2 for off.
// Read with the MTS200 handler, none of that matched, so the temperature sat at
// HomeKit's default of 0 and the heat switch never moved (#809).
const ON = 1
const OFF = 2
const WORKING_HEAT = 1
const WORKING_COOL = 2
const MODE_HEAT_COOL = 1

export default class {
  constructor(platform, accessory) {
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform
    this.accessory = accessory
    this.name = accessory.displayName
    const cloudRefreshRate = hasProperty(platform.config, 'cloudRefreshRate')
      ? platform.config.cloudRefreshRate
      : platformConsts.defaultValues.cloudRefreshRate
    const localRefreshRate = hasProperty(platform.config, 'refreshRate')
      ? platform.config.refreshRate
      : platformConsts.defaultValues.refreshRate
    this.pollInterval = accessory.context.connection === 'local'
      ? localRefreshRate
      : cloudRefreshRate
    this.tempScale = 100

    this.service = this.accessory.getService(this.hapServ.Thermostat)
      || this.accessory.addService(this.hapServ.Thermostat)

    // Off, heat and cool - the plug drives either a heater or a cooler
    this.service
      .getCharacteristic(this.hapChar.TargetHeatingCoolingState)
      .setProps({
        minValue: 0,
        maxValue: 2,
        validValues: [0, 1, 2],
      })
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState).value

    this.service
      .getCharacteristic(this.hapChar.TargetTemperature)
      .setProps({ minValue: 5, maxValue: 35, minStep: 0.5 })
      .onSet(async value => this.internalTargetUpdate(value))
    this.cacheTarg = this.service.getCharacteristic(this.hapChar.TargetTemperature).value
    this.cacheTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value

    this.accessory.eveService = new platform.eveService('custom', this.accessory, {
      log: () => {},
    })

    this.updateInProgress = false
    this.queue = new PQueue({
      concurrency: 1,
      interval: 250,
      intervalCap: 1,
      timeout: 10000,
      throwOnTimeout: true,
    })
    this.queue.addEventListener('idle', () => {
      this.updateInProgress = false
    })

    if (accessory.context.connection !== 'local') {
      this.accessory.mqtt = new mqttClient(platform, this.accessory)
      this.accessory.mqtt.connect()
    }

    setTimeout(() => this.requestUpdate(true), 2000)
    this.accessory.refreshInterval = setInterval(() => this.requestUpdate(), this.pollInterval * 1000)

    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, JSON.stringify({
      connection: this.accessory.context.connection,
    }))
  }

  async sendModeB(fields) {
    await this.platform.sendUpdate(this.accessory, {
      namespace: 'Appliance.Control.Thermostat.ModeB',
      payload: {
        modeB: [
          { channel: 0, ...fields },
        ],
      },
    })
  }

  async internalStateUpdate(value) {
    try {
      await this.queue.add(async () => {
        if (value === this.cacheState) {
          return
        }
        this.updateInProgress = true
        await this.sendModeB(value === 0
          ? { onoff: OFF }
          : {
              onoff: ON,
              mode: MODE_HEAT_COOL,
              working: value === 2
                ? WORKING_COOL
                : WORKING_HEAT,
            })
        this.cacheState = value
        this.accessory.log(`${platformLang.curState} [${['off', 'heat', 'cool'][value]}]`)
      })
    } catch (err) {
      const eText = isTimeoutError(err)
        ? platformLang.timeout
        : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetHeatingCoolingState, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalTargetUpdate(value) {
    try {
      await this.queue.add(async () => {
        if (value === this.cacheTarg) {
          return
        }
        this.updateInProgress = true
        await this.sendModeB({
          mode: MODE_HEAT_COOL,
          working: this.cacheState === 2
            ? WORKING_COOL
            : WORKING_HEAT,
          targetTemp: Math.round(value * this.tempScale),
        })
        this.cacheTarg = value
        this.accessory.log(`${platformLang.curTarg} [${value}°C]`)
      })
    } catch (err) {
      const eText = isTimeoutError(err)
        ? platformLang.timeout
        : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetTemperature, this.cacheTarg)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async requestUpdate(firstRun = false) {
    try {
      if (this.updateInProgress) {
        return
      }
      await this.queue.add(async () => {
        this.updateInProgress = true
        const res = await this.platform.sendUpdate(this.accessory, {
          namespace: 'Appliance.System.All',
          payload: {},
        })
        this.accessory.logDebug(`${platformLang.incPoll}: ${JSON.stringify(res.data)}`)
        const data = res.data.payload
        if (data.all?.digest?.thermostat) {
          this.applyUpdate(data.all.digest.thermostat)
        }
        if (firstRun && data.all?.system?.hardware) {
          this.accessory.context.macAddress = data.all.system.hardware.macAddress.toUpperCase()
          this.accessory.context.hardware = data.all.system.hardware.version
          this.accessory.context.firmware = data.all.system.firmware?.version
          this.platform.updateAccessory(this.accessory)
        }
      })
    } catch (err) {
      const eText = isTimeoutError(err)
        ? platformLang.timeout
        : parseError(err)
      this.accessory.logDebugWarn(`${platformLang.reqFailed}: ${eText}`)
    }
  }

  receiveUpdate(params) {
    try {
      this.accessory.logDebug(`${platformLang.incMQTT}: ${JSON.stringify(params)}`)
      if (params.payload) {
        this.applyUpdate(params.payload)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }

  applyUpdate(data) {
    const modeData = data.modeB?.[0]
    if (!modeData) {
      return
    }
    if (hasProperty(modeData, 'onoff') || hasProperty(modeData, 'working')) {
      const onoff = modeData.onoff ?? (this.cacheState === 0
        ? OFF
        : ON)
      const working = modeData.working ?? (this.cacheState === 2
        ? WORKING_COOL
        : WORKING_HEAT)
      const newState = onoff === ON
        ? (working === WORKING_COOL
            ? 2
            : 1)
        : 0
      if (this.cacheState !== newState) {
        this.service.updateCharacteristic(this.hapChar.TargetHeatingCoolingState, newState)
        this.cacheState = newState
        this.accessory.log(`${platformLang.curState} [${['off', 'heat', 'cool'][newState]}]`)
      }
    }
    // Schedule and timer modes report a target of 0, which is not a setpoint
    if (modeData.targetTemp > 0) {
      const newTarg = Math.min(35, Math.max(5, Math.round(modeData.targetTemp / 50) / 2))
      if (this.cacheTarg !== newTarg) {
        this.service.updateCharacteristic(this.hapChar.TargetTemperature, newTarg)
        this.cacheTarg = newTarg
        this.accessory.log(`${platformLang.curTarg} [${newTarg}°C]`)
      }
    }
    if (hasProperty(modeData, 'currentTemp')) {
      const newTemp = modeData.currentTemp / this.tempScale
      if (this.cacheTemp !== newTemp) {
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, newTemp)
        this.cacheTemp = newTemp
        this.accessory.eveService.addEntry({ temp: newTemp })
        this.accessory.log(`${platformLang.curTemp} [${newTemp}°C]`)
      }
    }
    // `state` is the relay: 1 when the plug is powering the heater or cooler
    if (hasProperty(modeData, 'state')) {
      const relayOn = modeData.state === ON && this.cacheState !== 0
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeatingCoolingState,
        relayOn ? this.cacheState : 0,
      )
    }
  }
}
