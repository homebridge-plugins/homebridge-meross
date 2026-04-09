import PQueue from 'p-queue'
import { TimeoutError } from 'p-timeout'

import mqttClient from '../connection/mqtt.js'
import platformConsts from '../utils/constants.js'
import { hasProperty, parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.cusChar = platform.cusChar
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
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

    // MTS300 temperature values are scaled by 100 (0.01°C resolution)
    this.tempScale = 100

    // MTS300 mode mapping: 0=off, 1=heat, 2=cool, 3=auto
    this.mode2Label = {
      0: 'off',
      1: 'heat',
      2: 'cool',
      3: 'auto',
    }

    // Fan speed mapping: device 0-3 to HomeKit 0/33/66/100
    this.mr2hk = (speed) => {
      if (speed === 0) {
        return 0
      }
      if (speed === 1) {
        return 33
      }
      if (speed === 2) {
        return 66
      }
      return 100
    }
    this.hk2mr = (speed) => {
      if (speed <= 16) {
        return 0
      }
      if (speed <= 49) {
        return 1
      }
      if (speed <= 82) {
        return 2
      }
      return 3
    }

    // Add the thermostat service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Thermostat)
      || this.accessory.addService(this.hapServ.Thermostat)

    // MTS300 supports off/heat/cool/auto (0, 1, 2, 3)
    this.service
      .getCharacteristic(this.hapChar.TargetHeatingCoolingState)
      .setProps({
        minValue: 0,
        maxValue: 3,
        validValues: [0, 1, 2, 3],
      })
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState).value

    this.service
      .getCharacteristic(this.hapChar.TargetTemperature)
      .setProps({
        minValue: 5,
        maxValue: 35,
        minStep: 0.5,
      })
      .onSet(async value => this.internalTargetUpdate(value))
    this.cacheTarg = this.service.getCharacteristic(this.hapChar.TargetTemperature).value

    this.cacheTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
    this.updateCache()

    // Add the humidity sensor service if it doesn't already exist
    this.humiService = this.accessory.getService(this.hapServ.HumiditySensor)
      || this.accessory.addService(this.hapServ.HumiditySensor)
    this.cacheHumi = this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value

    // Add the fan service if it doesn't already exist
    this.fanService = this.accessory.getService('Fan')
      || this.accessory.addService(this.hapServ.Fan, 'Fan', 'fan')

    this.fanService
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalFanStateUpdate(value))
    this.cacheFanState = this.fanService.getCharacteristic(this.hapChar.On).value

    this.fanService
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minStep: 33,
        validValues: [0, 33, 66, 100],
      })
      .onSet(async value => this.internalFanSpeedUpdate(value))
    this.cacheFanSpeed = this.hk2mr(
      this.fanService.getCharacteristic(this.hapChar.RotationSpeed).value,
    )

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('custom', this.accessory, { log: () => {} })

    // Create the queue used for sending device requests
    this.updateInProgress = false
    this.queue = new PQueue({
      concurrency: 1,
      interval: 250,
      intervalCap: 1,
      timeout: 10000,
      throwOnTimeout: true,
    })
    this.queue.on('idle', () => {
      this.updateInProgress = false
    })

    // Set up the mqtt client for cloud devices to send and receive device updates
    if (accessory.context.connection !== 'local') {
      this.accessory.mqtt = new mqttClient(platform, this.accessory)
      this.accessory.mqtt.connect()
    }

    // Always request a device update on startup, then start the interval for polling
    setTimeout(() => this.requestUpdate(true), 2000)
    this.accessory.refreshInterval = setInterval(
      () => this.requestUpdate(),
      this.pollInterval * 1000,
    )

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
    })
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      await this.queue.add(async () => {
        if (value === this.cacheState) {
          return
        }

        this.updateInProgress = true

        const namespace = 'Appliance.Control.Thermostat.ModeC'
        const payload = {
          modeC: [
            {
              channel: 0,
              onoff: value ? 1 : 0,
              mode: value,
            },
          ],
        }

        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        this.cacheState = value
        this.accessory.log(`${platformLang.curState} [${this.mode2Label[value] || 'unknown'}]`)
      })
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
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

        // Send the appropriate setpoint based on current mode
        const scaledValue = value * this.tempScale
        const payload = { modeC: [{ channel: 0 }] }
        if (this.cacheState === 2) {
          payload.modeC[0].coolSetpoint = scaledValue
        } else {
          payload.modeC[0].heatSetpoint = scaledValue
        }

        const namespace = 'Appliance.Control.Thermostat.ModeC'

        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        this.cacheTarg = value
        this.accessory.log(`${platformLang.curTarg} [${value}°C]`)

        // Update the current heating/cooling state
        this.updateCurrentState()
      })
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetTemperature, this.cacheTarg)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalFanStateUpdate(value) {
    try {
      await this.queue.add(async () => {
        if (value === this.cacheFanState) {
          return
        }

        this.updateInProgress = true

        const namespace = 'Appliance.Control.Thermostat.ModeC'
        const payload = {
          modeC: [
            {
              channel: 0,
              fMode: value ? 1 : 0,
            },
          ],
        }

        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        this.cacheFanState = value
        this.accessory.log(`[fan] ${platformLang.curState} [${value ? 'on' : 'off'}]`)
      })
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.fanService.updateCharacteristic(this.hapChar.On, this.cacheFanState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalFanSpeedUpdate(value) {
    try {
      await this.queue.add(async () => {
        const mrVal = this.hk2mr(value)
        if (mrVal === this.cacheFanSpeed) {
          return
        }

        this.updateInProgress = true

        const namespace = 'Appliance.Control.Thermostat.ModeC'
        const payload = {
          modeC: [
            {
              channel: 0,
              speed: mrVal,
            },
          ],
        }

        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        this.cacheFanSpeed = mrVal
        this.accessory.log(`[fan] ${platformLang.curSpeed} [${mrVal}]`)
      })
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.fanService.updateCharacteristic(
          this.hapChar.RotationSpeed,
          this.mr2hk(this.cacheFanSpeed),
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  updateCurrentState() {
    let currentState = 0
    if (this.cacheState === 1 && this.cacheTarg > this.cacheTemp) {
      currentState = 1 // heating
    } else if (this.cacheState === 2 && this.cacheTarg < this.cacheTemp) {
      currentState = 2 // cooling
    } else if (this.cacheState === 3) {
      if (this.cacheTarg > this.cacheTemp) {
        currentState = 1 // heating
      } else if (this.cacheTarg < this.cacheTemp) {
        currentState = 2 // cooling
      }
    }
    this.service.updateCharacteristic(this.hapChar.CurrentHeatingCoolingState, currentState)
  }

  async updateCache() {
    if (!this.platform.storageClientData) {
      return
    }

    try {
      await this.platform.storageData.setItem(
        `${this.accessory.context.serialNumber}_temp`,
        this.cacheTemp,
      )
    } catch (err) {
      this.accessory.logWarn(`${platformLang.storageWriteErr} ${parseError(err)}`)
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
        if (data.all) {
          if (data.all.digest?.thermostat) {
            this.applyUpdate(data.all.digest.thermostat)
          }

          let needsUpdate = false

          if (data.all.system) {
            if (firstRun && data.all.system.hardware) {
              this.accessory.context.macAddress = data.all.system.hardware.macAddress.toUpperCase()
              this.accessory.context.hardware = data.all.system.hardware.version
            }

            if (data.all.system.firmware) {
              if (this.accessory.context.ipAddress !== data.all.system.firmware.innerIp) {
                this.accessory.context.ipAddress = data.all.system.firmware.innerIp
                needsUpdate = true
              }

              if (firstRun) {
                this.accessory.context.firmware = data.all.system.firmware.version
              }
            }
          }

          if (data.all.system.online) {
            const isOnline = data.all.system.online.status === 1
            if (this.accessory.context.isOnline !== isOnline) {
              this.accessory.context.isOnline = isOnline
              needsUpdate = true
            }
          }

          if (needsUpdate || firstRun) {
            this.platform.updateAccessory(this.accessory)
          }
        }
      })
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logDebugWarn(`${platformLang.reqFailed}: ${eText}`)

      if (
        (this.accessory.context.isOnline || firstRun)
        && ['EHOSTUNREACH', 'timed out'].some(el => eText.includes(el))
      ) {
        this.accessory.context.isOnline = false
        this.platform.updateAccessory(this.accessory)
      }
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
    try {
      // MTS300 uses modeC instead of mode
      const modeData = data.modeC?.[0]
      if (modeData) {
        let needsUpdate = false

        // Update on/off and mode state
        if (hasProperty(modeData, 'onoff') || hasProperty(modeData, 'mode')) {
          const newOnoff = hasProperty(modeData, 'onoff') ? modeData.onoff : undefined
          const newMode = hasProperty(modeData, 'mode') ? modeData.mode : undefined

          // Determine the target state: off if onoff=0, otherwise use mode
          let newState
          if (newOnoff === 0) {
            newState = 0
          } else if (newMode !== undefined) {
            newState = newMode
          }

          if (newState !== undefined && this.cacheState !== newState) {
            this.service.updateCharacteristic(this.hapChar.TargetHeatingCoolingState, newState)
            this.cacheState = newState
            this.accessory.log(`${platformLang.curState} [${this.mode2Label[newState] || 'unknown'}]`)
            needsUpdate = true
          }
        }

        // Update target temperature from heat or cool setpoint
        if (hasProperty(modeData, 'heatSetpoint') || hasProperty(modeData, 'coolSetpoint')) {
          let newTarg
          if (this.cacheState === 2 && hasProperty(modeData, 'coolSetpoint')) {
            newTarg = modeData.coolSetpoint / this.tempScale
          } else if (hasProperty(modeData, 'heatSetpoint')) {
            newTarg = modeData.heatSetpoint / this.tempScale
          } else if (hasProperty(modeData, 'coolSetpoint')) {
            newTarg = modeData.coolSetpoint / this.tempScale
          }

          if (newTarg !== undefined && this.cacheTarg !== newTarg) {
            this.service.updateCharacteristic(this.hapChar.TargetTemperature, newTarg)
            this.cacheTarg = newTarg
            this.accessory.log(`${platformLang.curTarg} [${newTarg}°C]`)
            needsUpdate = true
          }
        }

        // Update current temperature
        const tempField = hasProperty(modeData, 'currentTemp')
          ? 'currentTemp'
          : hasProperty(modeData, 'sensorTemp')
            ? 'sensorTemp'
            : null
        if (tempField) {
          const newTemp = modeData[tempField] / this.tempScale

          if (this.cacheTemp !== newTemp) {
            this.service.updateCharacteristic(this.hapChar.CurrentTemperature, newTemp)
            this.cacheTemp = newTemp
            this.accessory.eveService.addEntry({ temp: newTemp })
            this.accessory.log(`${platformLang.curTemp} [${newTemp}°C]`)
            needsUpdate = true
            this.updateCache()
          }
        }

        // Update fan state and speed
        if (hasProperty(modeData, 'fMode')) {
          const newFanState = modeData.fMode !== 0
          if (this.cacheFanState !== newFanState) {
            this.fanService.updateCharacteristic(this.hapChar.On, newFanState)
            this.cacheFanState = newFanState
            this.accessory.log(`[fan] ${platformLang.curState} [${newFanState ? 'on' : 'off'}]`)
          }
        }
        if (hasProperty(modeData, 'speed')) {
          const newSpeed = modeData.speed
          if (this.cacheFanSpeed !== newSpeed) {
            this.cacheFanSpeed = newSpeed
            this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, this.mr2hk(newSpeed))
            this.accessory.log(`[fan] ${platformLang.curSpeed} [${newSpeed}]`)
          }
        }

        if (needsUpdate) {
          this.updateCurrentState()
        }
      }

      // Humidity data may come in a "more" object or sensor data
      const moreData = data.more || data.modeC?.[0]
      if (moreData && hasProperty(moreData, 'humi')) {
        const newHumi = moreData.humi / 10

        if (this.cacheHumi !== newHumi) {
          this.humiService.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, newHumi)
          this.cacheHumi = newHumi
          this.accessory.log(`${platformLang.curHumi} [${newHumi}%]`)
        }
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }
}
