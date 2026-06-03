import { id_sha256WithRSAEncryption } from '@peculiar/asn1-rsa'

export type PassportRegistrationPublicKeyAlgorithm = 'RSA' | 'ECDSA' | 'UNKNOWN'

export type PassportRegistrationDataSizeClass =
  | 'rsa-2048'
  | 'rsa-3072'
  | 'rsa-4096+'
  | 'ecdsa'
  | 'unknown'

export type PassportRegistrationPathId =
  | 'rarimo-mainnet-rsa2048-sha256-signer-swap'
  | 'default-registration-path'

export type PassportRegistrationProfile = {
  chainId: string
  publicKeyAlgorithm: PassportRegistrationPublicKeyAlgorithm
  publicKeySizeBits: number
  signatureAlgorithmOid: string
}

export type PassportRegistrationPathDecision = {
  pathId: PassportRegistrationPathId
  description: string
  dataSizeClass: PassportRegistrationDataSizeClass
  dispatcherHashAlgorithmOverride?: string
}

type PassportRegistrationPathRule = {
  id: PassportRegistrationPathId
  description: string
  dispatcherHashAlgorithmOverride?: string
  matches: (profile: PassportRegistrationProfile) => boolean
}

const RARIMO_MAINNET_CHAIN_ID = '7368'

const PASSPORT_REGISTRATION_PATH_RULES: PassportRegistrationPathRule[] = [
  {
    id: 'rarimo-mainnet-rsa2048-sha256-signer-swap',
    description:
      'Use SHA1 dispatcher suffix for RSA-2048 SHA-256 certs on Rarimo mainnet signer-swap setup',
    dispatcherHashAlgorithmOverride: 'SHA1',
    matches: profile =>
      profile.chainId === RARIMO_MAINNET_CHAIN_ID &&
      profile.publicKeyAlgorithm === 'RSA' &&
      profile.publicKeySizeBits === 2048 &&
      profile.signatureAlgorithmOid === id_sha256WithRSAEncryption,
  },
  {
    id: 'default-registration-path',
    description: 'Use default dispatcher mapping from certificate signature algorithm',
    matches: () => true,
  },
]

export const classifyPassportDataSizeClass = (
  profile: PassportRegistrationProfile,
): PassportRegistrationDataSizeClass => {
  if (profile.publicKeyAlgorithm === 'ECDSA') return 'ecdsa'
  if (profile.publicKeyAlgorithm !== 'RSA') return 'unknown'

  if (profile.publicKeySizeBits <= 2048) return 'rsa-2048'
  if (profile.publicKeySizeBits <= 3072) return 'rsa-3072'
  return 'rsa-4096+'
}

export const resolvePassportRegistrationPath = (
  profile: PassportRegistrationProfile,
): PassportRegistrationPathDecision => {
  const selectedRule =
    PASSPORT_REGISTRATION_PATH_RULES.find(rule => rule.matches(profile)) ??
    PASSPORT_REGISTRATION_PATH_RULES[PASSPORT_REGISTRATION_PATH_RULES.length - 1]

  return {
    pathId: selectedRule.id,
    description: selectedRule.description,
    dataSizeClass: classifyPassportDataSizeClass(profile),
    dispatcherHashAlgorithmOverride: selectedRule.dispatcherHashAlgorithmOverride,
  }
}
