export type IdentityCreationFailureCode =
  | 'NFC_RESULT_MISSING'
  | 'NFC_RESULT_INVALID'
  | 'PASSPORT_VERIFICATION_MISSING_FIELD'
  | 'FACE_RESULT_MISSING'
  | 'WALLET_CREATION_FAILED'
  | 'CREDENTIAL_GENERATION_FAILED'
  | 'PROOF_GENERATION_FAILED'
  | 'SECURE_STORAGE_FAILED'
  | 'API_REQUEST_FAILED'
  | 'UNKNOWN_IDENTITY_CREATION_FAILURE'

export type IdentityLogDomain =
  | 'IdentityProof'
  | 'PassportVerification'
  | 'WalletCredential'
  | 'NfcResult'
  | 'SecureStorage'

const MAX_ERROR_MESSAGE_LENGTH = 320

const trimMessage = (message: string): string => {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) return message
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`
}

const getErrorString = (value: unknown): string | undefined => {
  if (typeof value === 'string') return trimMessage(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function sanitizeResponseDataForLog(data: unknown): Record<string, unknown> {
  if (typeof data === 'string') {
    return {
      responseDataType: 'string',
      responseDataMessage: trimMessage(data),
    }
  }

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    return {
      responseDataType: 'object',
      responseDataKeys: Object.keys(record),
      ...(getErrorString(record.message)
        ? { responseDataMessage: getErrorString(record.message) }
        : {}),
      ...(getErrorString(record.error) ? { responseDataError: getErrorString(record.error) } : {}),
      ...(getErrorString(record.code) ? { responseDataCode: getErrorString(record.code) } : {}),
    }
  }

  if (data === undefined || data === null) {
    return {
      responseDataType: 'empty',
    }
  }

  return {
    responseDataType: typeof data,
  }
}

export function sanitizeErrorForLog(error: unknown): Record<string, unknown> {
  if (!error) {
    return { type: typeof error, message: 'Unknown error' }
  }

  if (error instanceof Error) {
    const err = error as Error & {
      code?: unknown
      status?: unknown
      response?: { status?: unknown; data?: unknown }
      isAxiosError?: unknown
    }

    return {
      type: error.constructor?.name ?? 'Error',
      name: error.name,
      message: trimMessage(error.message || 'Unknown error'),
      ...(getErrorString(err.code) ? { code: getErrorString(err.code) } : {}),
      ...(typeof err.status === 'number' ? { status: err.status } : {}),
      ...(typeof err.response?.status === 'number' ? { responseStatus: err.response.status } : {}),
      ...(err.response ? sanitizeResponseDataForLog(err.response.data) : {}),
      ...(err.isAxiosError === true ? { isAxiosError: true } : {}),
      ...(__DEV__ && error.stack ? { stack: trimMessage(error.stack) } : {}),
    }
  }

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = getErrorString(record.message) ?? 'Non-Error throw'
    const code = getErrorString(record.code)
    const response = record.response as { status?: unknown } | undefined

    return {
      type: 'Object',
      message,
      ...(code ? { code } : {}),
      ...(typeof response?.status === 'number' ? { responseStatus: response.status } : {}),
      ...(__DEV__ ? { objectKeys: Object.keys(record) } : {}),
    }
  }

  return {
    type: typeof error,
    message: getErrorString(error) ?? 'Unknown non-object error',
  }
}

const stageIncludes = (stage: string, tokens: string[]): boolean => {
  return tokens.some(token => stage.includes(token))
}

export function classifyIdentityCreationError(params: {
  stage?: string
  error?: unknown
}): IdentityCreationFailureCode {
  const stage = params.stage?.toLowerCase() ?? ''

  if (stageIncludes(stage, ['nfc-missing', 'missing-nfc', 'edoc-missing'])) {
    return 'NFC_RESULT_MISSING'
  }

  if (stageIncludes(stage, ['nfc-invalid', 'invalid-nfc', 'mapping'])) {
    return 'NFC_RESULT_INVALID'
  }

  if (stageIncludes(stage, ['passport-field', 'passport-data', 'sod-parse'])) {
    return 'PASSPORT_VERIFICATION_MISSING_FIELD'
  }

  if (stageIncludes(stage, ['csca', 'slave-master'])) {
    return 'PASSPORT_VERIFICATION_MISSING_FIELD'
  }

  if (stageIncludes(stage, ['face', 'comparison'])) {
    return 'FACE_RESULT_MISSING'
  }

  if (stageIncludes(stage, ['wallet', 'private-key', 'public-key'])) {
    return 'WALLET_CREATION_FAILED'
  }

  if (
    stageIncludes(stage, [
      'relayer',
      'api',
      'transaction',
      'register-call',
      'slave-proof-fetch',
      'passport-info-fetch',
    ])
  ) {
    return 'API_REQUEST_FAILED'
  }

  if (stageIncludes(stage, ['credential', 'identity-item'])) {
    return 'CREDENTIAL_GENERATION_FAILED'
  }

  if (stageIncludes(stage, ['proof', 'circuit', 'call-data'])) {
    return 'PROOF_GENERATION_FAILED'
  }

  if (stageIncludes(stage, ['storage', 'persist'])) {
    return 'SECURE_STORAGE_FAILED'
  }

  const sanitized = sanitizeErrorForLog(params.error)
  const message = String(sanitized.message ?? '').toLowerCase()
  const name = String(sanitized.name ?? '').toLowerCase()
  const type = String(sanitized.type ?? '').toLowerCase()
  const code = String(sanitized.code ?? '').toLowerCase()
  const responseStatus = Number(sanitized.responseStatus ?? 0)
  const isAxiosError = Boolean(sanitized.isAxiosError)

  if (
    message.includes('missing_dg1') ||
    message.includes('missing_sod') ||
    message.includes('native nfc read did not return')
  ) {
    return 'NFC_RESULT_MISSING'
  }

  if (
    message.includes('invalid hex') ||
    message.includes('packagenfcmappingerror') ||
    name.includes('packagenfcmappingerror')
  ) {
    return 'NFC_RESULT_INVALID'
  }

  if (message.includes('face') && message.includes('missing')) {
    return 'FACE_RESULT_MISSING'
  }

  if (message.includes('private key') || message.includes('public key')) {
    return 'WALLET_CREATION_FAILED'
  }

  if (message.includes('securestore') || message.includes('storage')) {
    return 'SECURE_STORAGE_FAILED'
  }

  if (
    message.includes('axios') ||
    message.includes('network') ||
    message.includes('relayer') ||
    message.includes('transaction not found') ||
    code.includes('err_bad_response') ||
    isAxiosError ||
    responseStatus >= 400
  ) {
    return 'API_REQUEST_FAILED'
  }

  if (type.includes('typeerror') && message.includes('certificate')) {
    return 'PASSPORT_VERIFICATION_MISSING_FIELD'
  }

  return 'UNKNOWN_IDENTITY_CREATION_FAILURE'
}

export function logIdentityDiagnostic(
  domain: IdentityLogDomain,
  event: string,
  metadata?: Record<string, unknown>,
): void {
  if (!__DEV__) {
    return
  }

  if (metadata && Object.keys(metadata).length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[${domain}] ${event}`, metadata)
    return
  }

  // eslint-disable-next-line no-console
  console.log(`[${domain}] ${event}`)
}

export function logIdentityDiagnosticError(params: {
  domain: IdentityLogDomain
  event: string
  stage?: string
  classification: IdentityCreationFailureCode
  error: unknown
  context?: Record<string, unknown>
}): void {
  const { domain, event, stage, classification, error, context } = params
  const sanitizedError = sanitizeErrorForLog(error)

  console.error(`[${domain}] ${event}`, {
    classification,
    ...(stage ? { stage } : {}),
    ...(context ? context : {}),
    error: sanitizedError,
  })
}
