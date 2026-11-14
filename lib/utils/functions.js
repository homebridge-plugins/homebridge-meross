import { Buffer } from 'node:buffer'
import { isIP } from 'node:net'

const encodeParams = params => Buffer.from(JSON.stringify(params)).toString('base64')

/**
 * The host part of a configured device address, ready for http://<host>/config.
 *
 * An address may be an IP, a local DNS or .local name, or either with a port.
 * A pasted URL, a path or credentials is not a host, so it gives undefined
 * instead of being written into the local request.
 */
function parseDeviceHost(value) {
  if (typeof value !== 'string') {
    return undefined
  }

  const address = value.trim()
  // The URL parser drops tabs and newlines inside a value without an error.
  if (address === '' || /\s/.test(address)) {
    return undefined
  }

  // Without brackets, the colons in an IPv6 address are read as a port.
  const forUrl = isIP(address) === 6
    ? `[${address}]`
    : address

  let url
  try {
    url = new URL(`http://${forUrl}`)
  } catch {
    return undefined
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return undefined
  }

  return url.host
}

function parseCachedTemperature(value) {
  // Shared persist holds more than temperatures. Only a number is a reading.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

function generateRandomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  while (nonce.length < length) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
}

const hasProperty = (obj, prop) => Object.hasOwn(obj, prop)

/**
 * Whether an error means a request ran out of time, whichever library threw it.
 *
 * The device queue and the connection both time requests out, but they report
 * it differently: the queue throws a DOMException named TimeoutError, and the
 * connection throws p-timeout's own TimeoutError class. Checking for the class
 * alone would miss the queue's timeouts and log them as a raw error instead of
 * the plain "timed out" message. Both carry the same name, so check that.
 */
function isTimeoutError(err) {
  return err?.name === 'TimeoutError'
}

function parseError(err, hideStack = []) {
  let toReturn = err.message
  if (err?.stack?.length > 0 && !hideStack.includes(err.message)) {
    const stack = err.stack.split('\n')
    if (stack[1]) {
      toReturn += stack[1].replace('   ', '')
    }
  }
  return toReturn
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export {
  encodeParams,
  generateRandomString,
  hasProperty,
  isTimeoutError,
  parseCachedTemperature,
  parseDeviceHost,
  parseError,
  sleep,
}
