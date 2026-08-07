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

    // Add the battery service if it doesn't already exist
    this.battService = this.accessory.getService(this.hapServ.Battery)
      || this.accessory.addService(this.hapServ.Battery)
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
      // This warned every incoming frame through `this.log`, which the class never
      // defines - so it threw on every update, the catch below turned that into a
      // warning the owner could do nothing about, and the battery reading was
      // never applied at all. Routine frames belong in the debug log.
      this.accessory.logDebug(JSON.stringify(data))

      // Battery % from reported voltage, the same way the other hub sensors do it
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
            this.cacheBatt < this.lowBattThreshold ? 1 : 0,
          )
        }
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }
}
