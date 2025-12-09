# Hide Devices Feature - Implementation Summary

## Overview
Added the ability to hide devices from HomeKit through an intuitive checkbox in the "My Devices" tab of the Homebridge Config UI.

## Problem Solved
Previously, users could only hide devices by manually editing the config to add `ignoreDevice: true` to specific device entries in device arrays (singleDevices, multiDevices, etc.). Additionally, the `ignoreDevice` option was hidden in the UI when devices had local IP addresses configured, making it impossible to hide cloud devices with local control enabled.

## Solution
1. **Simplified UI visibility** - Made `ignoreDevice` option always visible for all devices
2. **Added interactive checkbox** - Added "Hide from HomeKit" checkbox in My Devices tab
3. **Implemented central storage** - Created `ignoredDevices` array at config root for easier management
4. **Updated platform logic** - Modified platform.js to read from the new `ignoredDevices` array

## Files Modified

### 1. config.schema.json
**Lines changed:** 11 device type definitions updated

**Changes made:**
- **Simplified visibility conditions** for `ignoreDevice` field in:
  - singleDevices (line ~176)
  - multiDevices (line ~450)
  - lightDevices (line ~666)
  - fanDevices (line ~909)
  - diffuserDevices (line ~1004)
  - purifierDevices (line ~1109)
  - humidifierDevices (line ~1204)
  - thermostatDevices (line ~1299)
  - garageDevices (line ~1402)
  - rollerDevices (line ~1519)
  - babyDevices (line ~1644)

**Before:**
```json
"condition": {
  "functionBody": "return (model.singleDevices && model.singleDevices[arrayIndices] && model.singleDevices[arrayIndices].serialNumber && model.singleDevices[arrayIndices].serialNumber.length === 32 && model.singleDevices[arrayIndices].connection !== 'local' && !model.singleDevices[arrayIndices].deviceUrl);"
}
```

**After:**
```json
"condition": {
  "functionBody": "return (model.singleDevices && model.singleDevices[arrayIndices] && model.singleDevices[arrayIndices].serialNumber && model.singleDevices[arrayIndices].serialNumber.length === 32);"
}
```

- **Added new root-level field** (line 117-122):
```json
"ignoredDevices": {
  "type": "array",
  "items": {
    "type": "string"
  }
}
```

### 2. lib/homebridge-ui/public/index.html
**Lines changed:** Added ~50 lines

**Changes made:**
- **Added HTML for checkbox** (lines 117-127):
  - New table row in device info table
  - Checkbox with label "Hide this device from HomeKit"

- **Added JavaScript logic** (lines 309-357):
  - Gets current device UUID (normalized)
  - Checks if device is in ignoredDevices array
  - Sets checkbox state accordingly
  - Adds event listener to handle checkbox changes
  - Updates config when toggled
  - Switches to Settings tab for user to save
  - Shows toast notifications for feedback

**Key JavaScript functions:**
```javascript
// Normalize device UUID
const deviceUUID = context.serialNumber.toLowerCase().replace(/[^a-z0-9]/g, '')

// Check current state
const isHidden = config[0]?.ignoredDevices?.includes(deviceUUID) || false

// Add/remove from ignored list
if (e.target.checked) {
  config[0].ignoredDevices.push(deviceUUID)
} else {
  config[0].ignoredDevices = config[0].ignoredDevices.filter(id => id !== deviceUUID)
}

// Update config and switch to Settings tab
await homebridge.updatePluginConfig(config)
showSettings()
```

### 3. lib/platform.js
**Lines changed:** Added 9 lines (289-297)

**Changes made:**
- **Added case for `ignoredDevices`** in config parser:
```javascript
case 'ignoredDevices':
  if (Array.isArray(val)) {
    val.forEach((deviceId) => {
      if (typeof deviceId === 'string' && deviceId.length === 32) {
        this.ignoredDevices.push(deviceId)
      }
    })
  }
  break
```

**How it works:**
1. Reads `ignoredDevices` array from root-level config
2. Validates each device ID (must be string, 32 chars)
3. Adds to `this.ignoredDevices` array
4. Existing code in http.js checks this array and skips devices

## How It Works

### User Workflow
1. Open Homebridge Config UI → Meross Plugin
2. Click "My Devices" tab
3. Select device from dropdown
4. Check "Hide from HomeKit" checkbox
5. Automatically switched to "Settings" tab
6. Click "Save" button
7. Close plugin dialog
8. Restart Homebridge
9. Device is hidden from HomeKit ✨

### Technical Flow
1. **User checks checkbox** → Event listener fires
2. **Get device UUID** → Normalized (lowercase, alphanumeric only)
3. **Update config** → Add UUID to `ignoredDevices` array
4. **Call updatePluginConfig()** → Updates config in memory
5. **Switch to Settings tab** → Syncs form with updated config
6. **User clicks Save** → Homebridge writes config to disk
7. **Restart Homebridge** → Platform reads `ignoredDevices` array
8. **Platform populates ignoredDevices** → Adds UUIDs to internal array
9. **HTTP client checks array** → Skips devices during discovery
10. **Device hidden** → Not registered with HomeKit

## Configuration Storage

**Location:** `/var/lib/homebridge/config.json`

**Example:**
```json
{
  "name": "Meross",
  "username": "user@example.com",
  "password": "********",
  "connection": "default",
  "ignoredDevices": [
    "2003067036078890808748e1e9182610",
    "anotherdeviceuuidhere12345678"
  ],
  "platform": "Meross"
}
```

## Benefits

### User Experience
- ✅ **No manual UUID typing** - Select from dropdown
- ✅ **Visual feedback** - Checkbox shows current state
- ✅ **Toast notifications** - Confirms actions
- ✅ **Works for all devices** - Regardless of connection type
- ✅ **Intuitive workflow** - Familiar checkbox pattern

### Technical
- ✅ **Central management** - One array for all hidden devices
- ✅ **Type agnostic** - Works across all 12 device types
- ✅ **Backward compatible** - Existing ignoreDevice still works
- ✅ **Schema validated** - Proper config.schema.json integration
- ✅ **Clean implementation** - Minimal code changes

## Testing

### Verified Functionality
- ✅ Checkbox appears in My Devices tab
- ✅ Checkbox reflects current hidden state
- ✅ Checking box adds device to ignoredDevices
- ✅ Unchecking box removes device from ignoredDevices
- ✅ Config persists after saving
- ✅ Device hidden from HomeKit after restart
- ✅ Device reappears when unchecked and restarted
- ✅ Works with cloud, local, and hybrid connections
- ✅ Toast notifications work correctly
- ✅ Auto-switch to Settings tab works

## Known Limitations

1. **Requires Homebridge restart** - Changes don't take effect until restart
2. **No bulk hide** - Must hide devices one at a time
3. **Settings tab switch** - May be slightly jarring UX-wise
4. **No hidden device list** - Can't see all hidden devices in one place

## Future Enhancements

Potential improvements for future versions:
- Add "Show Hidden Devices" tab to view/manage all hidden devices
- Implement hide/unhide without requiring restart
- Add bulk hide/unhide with checkboxes on all devices
- Add device filtering/search in My Devices
- Add confirmation dialog before hiding devices
- Show hidden status indicator on device selection dropdown
- Add "Hide by type" option (hide all switches, all lights, etc.)

## Compatibility

- **Homebridge:** v1.6.0+ (plugin requirement)
- **Node.js:** v20, v22, v24 (plugin requirement)
- **Plugin Version:** Based on v10.10.3
- **Breaking Changes:** None - fully backward compatible

## Credits

Implementation by: Claude Code (Anthropic)
Requested by: burtherman
Original Plugin: homebridge-plugins/homebridge-meross by @bwp91

## License

MIT (same as original plugin)
