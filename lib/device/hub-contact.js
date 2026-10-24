import platformConsts from '../utils/constants.js'
import { hasProperty, parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
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

    // Add the contact sensor service if it doesn't already exist. This sensor
    // used to show a battery and nothing else, so an existing accessory gains it
    this.service = this.accessory.getService(this.hapServ.ContactSensor)
      || this.accessory.addService(this.hapServ.ContactSensor)
    this.service.setPrimaryService(true)
    this.cacheContact = this.service.getCharacteristic(this.hapChar.ContactSensorState).value

    // Add the battery service if it doesn't already exist
    this.battService = this.accessory.getService(this.hapServ.Battery) || this.accessory.addService(this.hapServ.Battery)
    this.cacheBatt = this.battService.getCharacteristic(this.hapChar.BatteryLevel).value

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      lowBattThreshold: this.lowBattThreshold,
    })
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts)
  }

  applyUpdate(data) {
    try {
      // The hub reports 1 when the door or window is open and 0 when it is
      // closed, which lines up with HomeKit's contact not detected (1) and
      // detected (0)
      if (hasProperty(data, 'contact') && [0, 1].includes(data.contact)) {
        if (data.contact !== this.cacheContact) {
          this.cacheContact = data.contact
          this.service.updateCharacteristic(this.hapChar.ContactSensorState, this.cacheContact)
          const label = this.cacheContact === 1
            ? 'open'
            : 'closed'
          this.accessory.log(`${platformLang.curContact} [${label}]`)
        }
      }

      // Battery % from reported voltage
      if (hasProperty(data, 'voltage')) {
        // 1. Reduce/enlarge value so in [2000, 3000]
        let newVoltage = Math.min(Math.max(data.voltage, 2000), 3000)

        // 2. Scale this from [2000, 3000] to [0, 100] and round to nearest whole number
        newVoltage = Math.round((newVoltage - 2000) / 10)

        // This should be a rough estimate of the battery %
        if (newVoltage !== this.cacheBatt) {
          this.cacheBatt = newVoltage
          this.battService.updateCharacteristic(this.hapChar.BatteryLevel, this.cacheBatt)
          this.battService.updateCharacteristic(
            this.hapChar.StatusLowBattery,
            this.cacheBatt < this.lowBattThreshold
              ? 1
              : 0,
          )
        }
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }
}
