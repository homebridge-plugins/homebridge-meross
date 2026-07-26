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

    this.mode2Label = {
      0: 'manual',
      1: 'heat',
      2: 'cool',
      3: 'auto',
      4: 'economy',
    }
    this.mode2Char = {
      0: false,
      1: this.cusChar.ValveHeatMode,
      2: this.cusChar.ValveCoolMode,
      3: this.cusChar.ValveAutoMode,
      4: this.cusChar.ValveEconomyMode,
    }

    // Add the thermostat service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Thermostat)
      || this.accessory.addService(this.hapServ.Thermostat)

    this.service
      .getCharacteristic(this.hapChar.TargetHeatingCoolingState)
      .setProps({
        minValue: 0,
        maxValue: 1,
        validValues: [0, 1],
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

    if (!this.service.testCharacteristic(this.cusChar.ValveHeatMode)) {
      this.service.addCharacteristic(this.cusChar.ValveHeatMode)
    }
    this.service
      .getCharacteristic(this.cusChar.ValveHeatMode)
      .onSet(async value => this.internalModeUpdate(value, 1))
    if (!this.service.testCharacteristic(this.cusChar.ValveCoolMode)) {
      this.service.addCharacteristic(this.cusChar.ValveCoolMode)
    }
    this.service
      .getCharacteristic(this.cusChar.ValveCoolMode)
      .onSet(async value => this.internalModeUpdate(value, 2))
    if (!this.service.testCharacteristic(this.cusChar.ValveAutoMode)) {
      this.service.addCharacteristic(this.cusChar.ValveAutoMode)
    }
    this.service
      .getCharacteristic(this.cusChar.ValveAutoMode)
      .onSet(async value => this.internalModeUpdate(value, 3))
    if (!this.service.testCharacteristic(this.cusChar.ValveEconomyMode)) {
      this.service.addCharacteristic(this.cusChar.ValveEconomyMode)
    }
    this.cacheMode = 0
    this.service
      .getCharacteristic(this.cusChar.ValveEconomyMode)
      .onSet(async value => this.internalModeUpdate(value, 4))

    // Add the humidity service if it doesn't already exist (separate namespace,
    // Appliance.Control.Sensor.Latest -- not bundled into Appliance.System.All)
    this.humidityService = this.accessory.getService(this.hapServ.HumiditySensor)
      || this.accessory.addService(this.hapServ.HumiditySensor)
    this.cacheHumi = this.humidityService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value

    // Window-open detection, frost protection and overheat protection are only exposed
    // as ContactSensors if they're actually armed on the device -- checked once against
    // the real device state on the first poll after startup (see requestUpdate/firstRun
    // below), rather than always creating the service and trying to signal "disabled"
    // through it. If armed/disarmed at the device between Homebridge restarts, this is
    // picked up the next time Homebridge restarts.
    this.windowService = this.accessory.getServiceById(this.hapServ.ContactSensor, 'window-open') || null
    this.frostService = this.accessory.getServiceById(this.hapServ.ContactSensor, 'frost-warning') || null
    this.overheatService = this.accessory.getServiceById(this.hapServ.ContactSensor, 'overheat-warning') || null

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
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheState) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace
        const namespace = 'Appliance.Control.Thermostat.Mode'
        const payload = {
          mode: [
            {
              channel: 0,
              onoff: value ? 1 : 0,
            },
          ],
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache and log the update has been successful
        this.cacheState = value
        this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`)
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetHeatingCoolingState, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalModeUpdate(value, newMode) {
    try {
      // If turning off then set to manual mode
      if (!value) {
        newMode = 0
      }

      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (newMode === this.cacheMode) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace
        const namespace = 'Appliance.Control.Thermostat.Mode'
        const payload = {
          mode: [
            {
              state: newMode,
            },
          ],
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache and log the update has been successful
        this.cacheState = value
        this.accessory.log(`${platformLang.curMode} [${this.mode2Label[newMode]}]`)

        // Turn the other modes off
        Object.entries(this.mode2Char).forEach((entry) => {
          const [mode, char] = entry
          if (char && mode !== newMode.toString()) {
            this.service.updateCharacteristic(char, false)
          }
        })
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.mode2Char[newMode], false)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalTargetUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheTarg) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace
        const namespace = 'Appliance.Control.Thermostat.Mode'
        const payload = {
          mode: [
            {
              channel: 0,
              mode: 4,
              manualTemp: value * 10,
            },
          ],
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache and log the update has been successful
        this.cacheTarg = value
        this.accessory.log(`${platformLang.curTarg} [${value}°C]`)

        // Update the current heating state
        this.service.updateCharacteristic(
          this.hapChar.CurrentHeatingCoolingState,
          value > this.cacheTemp ? 1 : 0,
        )

        // Turn the modes off as back to manual mode
        Object.values(this.mode2Char).forEach((char) => {
          if (char) {
            this.service.updateCharacteristic(char, false)
          }
        })
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetTemperature, this.cacheTarg)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async updateCache() {
    // Don't continue if the storage client hasn't initialised properly
    if (!this.platform.storageClientData) {
      return
    }

    // Attempt to save the new temperature to the cache
    try {
      await this.platform.storageData.setItem(
        `${this.accessory.context.serialNumber}_temp`,
        this.cacheTemp,
      )
    } catch (err) {
      this.accessory.logWarn(`${platformLang.storageWriteErr} ${parseError(err)}`)
    }
  }

  // Creates or removes a ContactSensor based on whether the corresponding protection
  // is armed on the device. Only called on the first poll after startup: these are
  // manually-configured device settings that don't change often, and re-evaluating on
  // every poll would mean live-adding/removing HomeKit services as they're toggled at
  // the device, which HomeKit clients don't always handle gracefully. If armed/disarmed
  // between Homebridge restarts, this is picked up the next time Homebridge restarts.
  ensureContactSensor(current, subtype, displayName, armed) {
    if (armed) {
      if (current) {
        return current
      }
      const service = this.accessory.getServiceById(this.hapServ.ContactSensor, subtype)
        || this.accessory.addService(this.hapServ.ContactSensor, displayName, subtype)
      service.updateCharacteristic(this.hapChar.Name, displayName)
      return service
    }
    if (current) {
      this.accessory.removeService(current)
    }
    return null
  }

  async requestUpdate(firstRun = false) {
    try {
      // Don't continue if an update is currently being sent to the device
      if (this.updateInProgress) {
        return
      }

      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Send the main status request
        const res = await this.platform.sendUpdate(this.accessory, {
          namespace: 'Appliance.System.All',
          payload: {},
        })

        // Log the received data
        this.accessory.logDebug(`${platformLang.incPoll}: ${JSON.stringify(res.data)}`)

        // Check the response is in a useful format
        const data = res.data.payload
        if (data.all) {
          if (data.all.digest?.thermostat) {
            // Only re-check whether window-open detection is armed on the first poll
            // after startup -- see ensureContactSensor for why
            if (firstRun) {
              const windowArmed = data.all.digest.thermostat.windowOpened?.[0]?.detect === 1
              this.windowService = this.ensureContactSensor(this.windowService, 'window-open', 'Window Open', windowArmed)
            }
            this.applyUpdate(data.all.digest.thermostat)
          }

          // A flag to check if we need to update the accessory context
          let needsUpdate = false

          // Get the mac address and hardware version of the device
          if (data.all.system) {
            // Mac address and hardware don't change regularly so only get on first poll
            if (firstRun && data.all.system.hardware) {
              this.accessory.context.macAddress = data.all.system.hardware.macAddress.toUpperCase()
              this.accessory.context.hardware = data.all.system.hardware.version
            }

            // Get the ip address and firmware of the device
            if (data.all.system.firmware) {
              // Check for an IP change each and every time the device is polled
              if (this.accessory.context.ipAddress !== data.all.system.firmware.innerIp) {
                this.accessory.context.ipAddress = data.all.system.firmware.innerIp
                needsUpdate = true
              }

              // Firmware doesn't change regularly so only get on first poll
              if (firstRun) {
                this.accessory.context.firmware = data.all.system.firmware.version
              }
            }
          }

          // Get the cloud online status of the device
          if (data.all.system.online) {
            const isOnline = data.all.system.online.status === 1
            if (this.accessory.context.isOnline !== isOnline) {
              this.accessory.context.isOnline = isOnline
              needsUpdate = true
            }
          }

          // Update the accessory cache if anything has changed
          if (needsUpdate || firstRun) {
            this.platform.updateAccessory(this.accessory)
          }
        }

        // Humidity, frost protection and overheat protection all live behind
        // separate namespaces for this device family -- not bundled into
        // Appliance.System.All, so they need their own requests.
        try {
          const humRes = await this.platform.sendUpdate(this.accessory, {
            namespace: 'Appliance.Control.Sensor.Latest',
            payload: { latest: [{ channel: 0 }] },
          })
          this.applyUpdate(humRes.data.payload)
        } catch (err) {
          this.accessory.logDebugWarn(`${platformLang.reqFailed} [humidity]: ${parseError(err)}`)
        }

        try {
          const frostRes = await this.platform.sendUpdate(this.accessory, {
            namespace: 'Appliance.Control.Thermostat.Frost',
            payload: { frost: [{ channel: 0 }] },
          })
          if (firstRun) {
            const frostArmed = frostRes.data.payload.frost?.[0]?.onoff === 1
            this.frostService = this.ensureContactSensor(this.frostService, 'frost-warning', 'Frost Protection', frostArmed)
          }
          this.applyUpdate(frostRes.data.payload)
        } catch (err) {
          this.accessory.logDebugWarn(`${platformLang.reqFailed} [frost]: ${parseError(err)}`)
        }

        try {
          const overheatRes = await this.platform.sendUpdate(this.accessory, {
            namespace: 'Appliance.Control.Thermostat.Overheat',
            payload: { overheat: [{ channel: 0 }] },
          })
          if (firstRun) {
            const overheatArmed = overheatRes.data.payload.overheat?.[0]?.onoff === 1
            this.overheatService = this.ensureContactSensor(this.overheatService, 'overheat-warning', 'Overheat Protection', overheatArmed)
          }
          this.applyUpdate(overheatRes.data.payload)
        } catch (err) {
          this.accessory.logDebugWarn(`${platformLang.reqFailed} [overheat]: ${parseError(err)}`)
        }
      })
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logDebugWarn(`${platformLang.reqFailed}: ${eText}`)

      // Set the homebridge-ui status of the device to offline if local and error is timeout
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
      // Log the received data
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
      const modeData = data.mode?.[0]
      if (modeData) {
        let needsUpdate = false
        if (hasProperty(modeData, 'state')) {
          const newState = modeData.state

          // Check against the cache and update HomeKit and the cache if needed
          if (this.cacheState !== newState) {
            this.service.updateCharacteristic(this.hapChar.TargetHeatingCoolingState, newState)
            this.cacheState = newState
            this.accessory.log(`${platformLang.curState} [${newState === 1 ? 'on' : 'off'}]`)
            needsUpdate = true
          }
        }
        if (hasProperty(modeData, 'targetTemp')) {
          const newTarg = modeData.targetTemp / 10

          // Check against the cache and update HomeKit and the cache if needed
          if (this.cacheTarg !== newTarg) {
            this.service.updateCharacteristic(this.hapChar.TargetTemperature, newTarg)
            this.cacheTarg = newTarg
            this.accessory.log(`${platformLang.curTarg} [${newTarg}°C]`)
            needsUpdate = true
          }
        }
        if (hasProperty(modeData, 'currentTemp')) {
          const newTemp = modeData.currentTemp / 10

          // Check against the cache and update HomeKit and the cache if needed
          if (this.cacheTemp !== newTemp) {
            this.service.updateCharacteristic(this.hapChar.CurrentTemperature, newTemp)
            this.cacheTemp = newTemp
            this.accessory.eveService.addEntry({ temp: newTemp })
            this.accessory.log(`${platformLang.curTemp} [${newTemp}°C]`)
            needsUpdate = true

            // Update the cache file with the new temperature
            this.updateCache()
          }
        }

        // Update the current heating state
        if (needsUpdate) {
          this.service.updateCharacteristic(
            this.hapChar.CurrentHeatingCoolingState,
            this.cacheState === 1 && this.cacheTarg > this.cacheTemp ? 1 : 0,
          )
        }
      }

      // Window-open detection arrives bundled inside the thermostat digest for a poll,
      // or standalone via an Appliance.Control.Thermostat.WindowOpened push -- same key either way
      // this.windowService only exists if window-open detection is armed on the device
      // (see ensureContactSensor)
      const windowData = data.windowOpened?.[0]
      if (windowData && this.windowService && hasProperty(windowData, 'status')) {
        const newWindow = windowData.status === 1 ? 1 : 0
        if (this.cacheWindow !== newWindow) {
          this.windowService.updateCharacteristic(this.hapChar.ContactSensorState, newWindow)
          this.cacheWindow = newWindow
          this.accessory.log(`${platformLang.curWindow} [${newWindow ? 'open' : 'closed'}]`)
        }
      }

      // this.frostService only exists if frost protection is armed on the device
      const frostData = data.frost?.[0]
      if (frostData && this.frostService && hasProperty(frostData, 'warning')) {
        // warning: 0 = no warning, 1 = warning, 2 = alarm unavailable (no sensor) -- only
        // 1 represents something actionable to surface as a triggered contact.
        const newFrostWarning = frostData.warning === 1 ? 1 : 0
        if (this.cacheFrostWarning !== newFrostWarning) {
          this.frostService.updateCharacteristic(this.hapChar.ContactSensorState, newFrostWarning)
          this.cacheFrostWarning = newFrostWarning
          this.accessory.log(`${platformLang.curFrostWarning} [${newFrostWarning ? 'triggered' : 'normal'}]`)
        }
      }

      // this.overheatService only exists if overheat protection is armed on the device
      const overheatData = data.overheat?.[0]
      if (overheatData && this.overheatService && hasProperty(overheatData, 'warning')) {
        const newOverheatWarning = overheatData.warning === 1 ? 1 : 0
        if (this.cacheOverheatWarning !== newOverheatWarning) {
          this.overheatService.updateCharacteristic(this.hapChar.ContactSensorState, newOverheatWarning)
          this.cacheOverheatWarning = newOverheatWarning
          this.accessory.log(`${platformLang.curOverheatWarning} [${newOverheatWarning ? 'triggered' : 'normal'}]`)
        }
      }

      const humData = data.latest?.[0]?.value?.[0]
      if (humData && hasProperty(humData, 'humi')) {
        const newHumi = humData.humi / 10
        if (this.cacheHumi !== newHumi) {
          this.humidityService.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, newHumi)
          this.cacheHumi = newHumi
          this.accessory.log(`${platformLang.curHumi} [${newHumi}%]`)
        }
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }
}
