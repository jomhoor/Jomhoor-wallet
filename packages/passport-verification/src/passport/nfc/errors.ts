import type { PassportNfcBackend, PassportNfcError, PassportNfcErrorCode } from './types'

export class PassportNfcException extends Error {
  public readonly detail: PassportNfcError

  constructor(detail: PassportNfcError) {
    super(detail.message)
    this.name = 'PassportNfcException'
    this.detail = detail
  }
}

export const createPassportNfcError = (
  code: PassportNfcErrorCode,
  message: string,
  backend?: PassportNfcBackend,
  cause?: unknown,
  debug?: Record<string, unknown>,
): PassportNfcException =>
  new PassportNfcException({
    code,
    message,
    domain: 'passport',
    ...(backend ? { backend } : {}),
    ...(cause !== undefined ? { cause } : {}),
    ...(debug ? { debug } : {}),
  })
