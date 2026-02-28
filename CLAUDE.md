# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Homebridge plugin that integrates Meross smart home devices into Apple HomeKit. Supports 31 device types with cloud (MQTT), local (HTTP), and hybrid connection modes. Written in JavaScript (ES modules), no TypeScript compilation step.

## Commands

- **Lint**: `npm run lint` (eslint with zero warnings allowed)
- **Lint + fix**: `npm run lint:fix`
- **Install**: `npm install`

There are no automated tests. CI runs linting only (Node 20, 22, 24).

## Code Style

Uses `@antfu/eslint-config` with these key rules:
- Single quotes, 1tbs brace style
- Sorted imports/exports via `perfectionist` plugin (grouped: types, then builtins, externals, internals)
- `no-undef` enabled
- Zero warnings tolerance (`--max-warnings=0`)

## Architecture

### Entry Point
`lib/index.js` registers the platform class with Homebridge under the alias "Meross".

### Platform (`lib/platform.js`)
Central orchestrator (~1250 lines). Key responsibilities:
- **`constructor`**: Validates config, sets up Homebridge event listeners
- **`applyUserConfig`**: Parses and validates per-device config arrays (singleDevices, multiDevices, lightDevices, etc.)
- **`pluginSetup`**: Cloud login, device list retrieval, initializes all devices
- **`pluginShutdown`**: Closes MQTT connections, clears intervals
- **`initialiseDevice`**: Factory that maps device models to device classes using `platformConsts.models.*` lookups
- **`sendUpdate`**: Hybrid control - tries local HTTP first, falls back to cloud MQTT

### Device Classes (`lib/device/`)
Each file exports a single class for one device type. Common pattern:
- Constructor sets up HAP services/characteristics and event handlers
- Uses `PQueue` (concurrency: 1, interval: 250ms) for sequential request queuing
- `internalStateUpdate(value)` - handles HomeKit commands → device
- `requestUpdate(firstRun)` - polls device state → HomeKit
- `externalUpdate(params)` - handles MQTT push updates → HomeKit
- State caching to prevent redundant updates

Multi-channel devices (garage, outlets, switches) create sub-accessories per channel. The garage door (MSG200) uses a 3-accessory pattern: hidden main + visible sub-doors.

### Connection Layer (`lib/connection/`)
- **`http.js`**: Cloud REST API client. MD5-based auth signatures, spoofs iOS Meross app headers.
- **`mqtt.js`**: Cloud real-time client. Subscribes to `/app/{userId}/subscribe`, publishes commands, waits for response by messageId matching.

### Utilities (`lib/utils/`)
- **`constants.js`**: Default config values, min values, device model → type mappings (this is where new device models are registered)
- **`functions.js`**: Small helpers (encodeParams, generateRandomString, hasProperty, parseError, sleep)
- **`colour.js`**: RGB↔HSV conversion, color temperature handling
- **`custom-chars.js`** / **`eve-chars.js`**: Custom HomeKit characteristics
- **`lang-en.js`**: All user-facing log strings

### Fakegato (`lib/fakegato/`)
Eve app history service integration for home analytics.

## Adding a New Device Type

1. Add the model string to the appropriate array in `lib/utils/constants.js` under `models`
2. Create a new device class in `lib/device/` following the existing pattern (see `switch-single.js` for a simple example)
3. Export it from `lib/device/index.js`
4. Add the initialization branch in `platform.js` `initialiseDevice()` method
5. If the device needs per-device config, add allowed fields in `constants.js` `allowed` object and update `config.schema.json`

## Configuration

`config.schema.json` (~90KB) defines the Homebridge UI config form. Global settings include connection mode, cloud credentials, and refresh rates. Per-device arrays allow overriding connection type, IP address (for local control), model code, and device-specific options.
