import platformConsts from '../utils/constants.js'
import { hasProperty, parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

// What the hub's `smokeAlarm.status` codes mean. 23 is the test button, 24 and
// 26 are a heat alarm, 25 and 27 are smoke (26 and 27 once muted). 17 to 22 are
// faults with the sensor itself, and 170 is all clear.
const ALARM_CODES = [23, 24, 25, 26, 27]
const FAULT_CODES = [17, 18, 19, 20, 21, 22]
const CLEAR_CODE = 170

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

    // Add the smoke sensor service if it doesn't already exist. This alarm
    // used to show a battery and nothing else, so an existing accessory gains it
    this.service = this.accessory.getService(this.hapServ.SmokeSensor)
      || this.accessory.addService(this.hapServ.SmokeSensor)
    this.service.setPrimaryService(true)
    this.cacheSmoke = this.service.getCharacteristic(this.hapChar.SmokeDetected).value
    this.cacheFault = this.service.getCharacteristic(this.hapChar.StatusFault).value

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

      // Smoke, heat and a test press all show as smoke, so a test proves the
      // alarm reaches HomeKit. A code not listed above is left alone.
      if (hasProperty(data, 'smoke')) {
        let newSmoke
        let newFault
        if (ALARM_CODES.includes(data.smoke)) {
          newSmoke = 1
          newFault = 0
        } else if (FAULT_CODES.includes(data.smoke)) {
          newSmoke = 0
          newFault = 1
        } else if (data.smoke === CLEAR_CODE) {
          newSmoke = 0
          newFault = 0
        } else {
          this.accessory.logWarn(`unknown smoke alarm status received: ${data.smoke}`)
        }
        if (newSmoke !== undefined && newSmoke !== this.cacheSmoke) {
          this.cacheSmoke = newSmoke
          this.service.updateCharacteristic(this.hapChar.SmokeDetected, this.cacheSmoke)
          const label = this.cacheSmoke === 1
            ? 'yes'
            : 'no'
          this.accessory.log(`${platformLang.curSmoke} [${label}]`)
        }
        if (newFault !== undefined && newFault !== this.cacheFault) {
          this.cacheFault = newFault
          this.service.updateCharacteristic(this.hapChar.StatusFault, this.cacheFault)
          const label = this.cacheFault === 1
            ? 'yes'
            : 'no'
          this.accessory.log(`${platformLang.curFault} [${label}]`)
        }
      }

      // Battery % as the hub itself reports it. Once one has arrived it is
      // used instead of the rough estimate from the voltage below, so the two
      // readings do not take turns
      if (typeof data.battery === 'number') {
        this.battFromHub = true
        const newBatt = Math.min(Math.max(Math.round(data.battery), 0), 100)
        if (newBatt !== this.cacheBatt) {
          this.cacheBatt = newBatt
          this.battService.updateCharacteristic(this.hapChar.BatteryLevel, this.cacheBatt)
          this.battService.updateCharacteristic(
            this.hapChar.StatusLowBattery,
            this.cacheBatt < this.lowBattThreshold
              ? 1
              : 0,
          )
        }
      }

      // Battery % from reported voltage, the same way the other hub sensors do it
      if (hasProperty(data, 'voltage') && !this.battFromHub) {
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
