import { randomBytes, timingSafeEqual } from 'node:crypto'

/** One token per server process; every POST form (and the login stream) must send it. */
export const csrfToken = randomBytes(32).toString('hex')

export function validToken(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length === csrfToken.length &&
    timingSafeEqual(Buffer.from(value), Buffer.from(csrfToken))
  )
}
