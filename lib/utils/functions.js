import { Buffer } from 'node:buffer'

const encodeParams = params => Buffer.from(JSON.stringify(params)).toString('base64')

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
  parseError,
  sleep,
}
