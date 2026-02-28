import PQueue from 'p-queue'
import { TimeoutError } from 'p-timeout'

import platformConsts from '../utils/constants.js'
import { hasProperty, parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory, priAcc) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.lowBattThreshold = accessory.context.options.lowBattThreshold
      ? Math.min(accessory.context.options.lowBattThreshold, 100)
      : platformConsts.defaultValues.lowBattThreshold
    this.name = accessory.displayName
    this.priAcc = priAcc

    // Add the valve service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Valve)
      || this.accessory.addService(this.hapServ.Valve)

    // Set the valve type to irrigation
    this.service.getCharacteristic(this.hapChar.ValveType).updateValue(1)

    // Set up Active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value

    // Set up InUse characteristic (mirrors Active)
    this.cacheInUse = this.service.getCharacteristic(this.hapChar.InUse).value

    // Set up SetDuration characteristic
    this.service
      .getCharacteristic(this.hapChar.SetDuration)
      .setProps({
        minValue: 0,
        maxValue: 43200,
        minStep: 60,
      })
      .onSet(async value => this.internalDurationUpdate(value))
    this.cacheDuration = this.service.getCharacteristic(this.hapChar.SetDuration).value || 3600

    // Set up RemainingDuration characteristic
    this.service
      .getCharacteristic(this.hapChar.RemainingDuration)
      .onGet(() => this.getRemainingDuration())

    // Add the battery service if it doesn't already exist
    this.battService = this.accessory.getService(this.hapServ.Battery)
      || this.accessory.addService(this.hapServ.Battery)
    this.cacheBatt = this.battService.getCharacteristic(this.hapChar.BatteryLevel).value

    // Activation timestamp for remaining duration calculation
    this.activationTime = 0
    this.durationTimer = null

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

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      lowBattThreshold: this.lowBattThreshold,
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
        // MST100 uses Appliance.Control.Water with onoff: 1=on, 2=off
        const namespace = 'Appliance.Control.Water'
        const payload = {
          control: [
            {
              subId: this.accessory.context.subSerialNumber,
              channel: 0,
              onoff: value ? 1 : 2,
              dura: value ? this.cacheDuration : 0,
            },
          ],
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.priAcc, {
          namespace,
          payload,
        })

        // Update the cache and log the update has been successful
        this.cacheState = value
        this.service.updateCharacteristic(this.hapChar.InUse, value)
        this.cacheInUse = value

        if (value) {
          this.startDurationTimer()
        } else {
          this.clearDurationTimer()
        }

        this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`)
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  internalDurationUpdate(value) {
    this.cacheDuration = value

    // If currently active, restart the timer with the new duration
    if (this.cacheState) {
      this.startDurationTimer()
    }
  }

  getRemainingDuration() {
    if (!this.cacheState || !this.activationTime) {
      return 0
    }
    const elapsed = Math.floor((Date.now() - this.activationTime) / 1000)
    const remaining = this.cacheDuration - elapsed
    return Math.max(0, remaining)
  }

  startDurationTimer() {
    this.clearDurationTimer()
    this.activationTime = Date.now()

    if (this.cacheDuration > 0) {
      this.durationTimer = setTimeout(() => {
        // Auto-mark inactive when duration expires
        this.cacheState = 0
        this.cacheInUse = 0
        this.service.updateCharacteristic(this.hapChar.Active, 0)
        this.service.updateCharacteristic(this.hapChar.InUse, 0)
        this.activationTime = 0
        this.accessory.log(`${platformLang.curState} [off] (duration expired)`)
      }, this.cacheDuration * 1000)
    }
  }

  clearDurationTimer() {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer)
      this.durationTimer = null
    }
    this.activationTime = 0
  }

  applyUpdate(data) {
    try {
      // Handle onoff state (1=on, 2=off)
      if (hasProperty(data, 'onoff')) {
        const newState = data.onoff === 1 ? 1 : 0

        if (this.cacheState !== newState) {
          this.service.updateCharacteristic(this.hapChar.Active, newState)
          this.service.updateCharacteristic(this.hapChar.InUse, newState)
          this.cacheState = newState
          this.cacheInUse = newState

          if (newState) {
            this.startDurationTimer()
          } else {
            this.clearDurationTimer()
          }

          this.accessory.log(`${platformLang.curState} [${newState ? 'on' : 'off'}]`)
        }
      }

      // Handle duration
      if (hasProperty(data, 'dura')) {
        const newDura = data.dura
        if (newDura > 0 && newDura !== this.cacheDuration) {
          this.cacheDuration = newDura
          this.service.updateCharacteristic(this.hapChar.SetDuration, newDura)
        }
      }

      // Battery % from reported voltage
      if (hasProperty(data, 'voltage')) {
        // Scale from [2000, 3000] to [0, 100]
        let newVoltage = Math.min(Math.max(data.voltage, 2000), 3000)
        newVoltage = Math.round((newVoltage - 2000) / 10)

        if (newVoltage !== this.cacheBatt) {
          this.cacheBatt = newVoltage
          this.battService.updateCharacteristic(this.hapChar.BatteryLevel, this.cacheBatt)
          this.battService.updateCharacteristic(
            this.hapChar.StatusLowBattery,
            this.cacheBatt < this.lowBattThreshold ? 1 : 0,
          )
        }
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }
}
