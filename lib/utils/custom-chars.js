export default class {
  constructor(api) {
    this.uuids = {
      diffColourMode: 'E962F001-079E-48FF-8F27-9C2605A29F52',
      diffRainbowMode: 'E962F002-079E-48FF-8F27-9C2605A29F52',
      diffTemperatureMode: 'E962F003-079E-48FF-8F27-9C2605A29F52',
      valveHeatMode: 'E962F004-079E-48FF-8F27-9C2605A29F52',
      valveCoolMode: 'E962F005-079E-48FF-8F27-9C2605A29F52',
      valveAutoMode: 'E962F006-079E-48FF-8F27-9C2605A29F52',
      valveEconomyMode: 'E962F007-079E-48FF-8F27-9C2605A29F52',
      valveWindowOpen: 'E962F008-079E-48FF-8F27-9C2605A29F52',
      lightNightWarm: 'E962F009-079E-48FF-8F27-9C2605A29F52',
      lightNightWhite: 'E962F010-079E-48FF-8F27-9C2605A29F52',
      babySceneOne: 'E962F011-079E-48FF-8F27-9C2605A29F52',
      babySceneTwo: 'E962F012-079E-48FF-8F27-9C2605A29F52',
      babySceneThree: 'E962F013-079E-48FF-8F27-9C2605A29F52',
      babySceneFour: 'E962F014-079E-48FF-8F27-9C2605A29F52',
    }

    const uuids = this.uuids

    this.DiffColourMode = class extends api.hap.Characteristic {
      constructor() {
        super('Colour Mode', uuids.diffColourMode)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.DiffRainbowMode = class extends api.hap.Characteristic {
      constructor() {
        super('Rainbow Mode', uuids.diffRainbowMode)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.DiffTemperatureMode = class extends api.hap.Characteristic {
      constructor() {
        super('Temperature Mode', uuids.diffTemperatureMode)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.ValveHeatMode = class extends api.hap.Characteristic {
      constructor() {
        super('Heat Mode', uuids.valveHeatMode)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.ValveCoolMode = class extends api.hap.Characteristic {
      constructor() {
        super('Cool Mode', uuids.valveCoolMode)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.ValveAutoMode = class extends api.hap.Characteristic {
      constructor() {
        super('Auto Mode', uuids.valveAutoMode)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.ValveEconomyMode = class extends api.hap.Characteristic {
      constructor() {
        super('Economy Mode', uuids.valveEconomyMode)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.ValveWindowOpen = class extends api.hap.Characteristic {
      constructor() {
        super('Window Open', uuids.valveWindowOpen)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.LightNightWarm = class extends api.hap.Characteristic {
      constructor() {
        super('Night Light Warm', uuids.lightNightWarm)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.LightNightWhite = class extends api.hap.Characteristic {
      constructor() {
        super('Night Light White', uuids.lightNightWhite)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.BabySceneOne = class extends api.hap.Characteristic {
      constructor() {
        super('Baby Scene 1', uuids.babySceneOne)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.BabySceneTwo = class extends api.hap.Characteristic {
      constructor() {
        super('Baby Scene 2', uuids.babySceneTwo)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.BabySceneThree = class extends api.hap.Characteristic {
      constructor() {
        super('Baby Scene 3', uuids.babySceneThree)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.BabySceneFour = class extends api.hap.Characteristic {
      constructor() {
        super('Baby Scene 4', uuids.babySceneFour)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.DiffColourMode.UUID = this.uuids.diffColourMode
    this.DiffRainbowMode.UUID = this.uuids.diffRainbowMode
    this.DiffTemperatureMode.UUID = this.uuids.diffTemperatureMode
    this.ValveHeatMode.UUID = this.uuids.valveHeatMode
    this.ValveCoolMode.UUID = this.uuids.valveCoolMode
    this.ValveAutoMode.UUID = this.uuids.valveAutoMode
    this.ValveEconomyMode.UUID = this.uuids.valveEconomyMode
    this.ValveWindowOpen.UUID = this.uuids.valveWindowOpen
    this.LightNightWarm.UUID = this.uuids.lightNightWarm
    this.LightNightWhite.UUID = this.uuids.lightNightWhite
    this.BabySceneOne.UUID = this.uuids.babySceneOne
    this.BabySceneTwo.UUID = this.uuids.babySceneTwo
    this.BabySceneThree.UUID = this.uuids.babySceneThree
    this.BabySceneFour.UUID = this.uuids.babySceneFour
  }
}
