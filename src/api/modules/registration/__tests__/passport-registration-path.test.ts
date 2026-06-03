import { id_sha256WithRSAEncryption } from '@peculiar/asn1-rsa'

import { resolvePassportRegistrationPath } from '../passport-registration-path'

describe('passport registration path routing', () => {
  it('uses mainnet workaround path for RSA-2048 SHA-256', () => {
    const decision = resolvePassportRegistrationPath({
      chainId: '7368',
      publicKeyAlgorithm: 'RSA',
      publicKeySizeBits: 2048,
      signatureAlgorithmOid: id_sha256WithRSAEncryption,
    })

    expect(decision.pathId).toBe('rarimo-mainnet-rsa2048-sha256-signer-swap')
    expect(decision.dispatcherHashAlgorithmOverride).toBe('SHA1')
    expect(decision.dataSizeClass).toBe('rsa-2048')
  })

  it('uses default path for RSA-3072 SHA-256', () => {
    const decision = resolvePassportRegistrationPath({
      chainId: '7368',
      publicKeyAlgorithm: 'RSA',
      publicKeySizeBits: 3072,
      signatureAlgorithmOid: id_sha256WithRSAEncryption,
    })

    expect(decision.pathId).toBe('default-registration-path')
    expect(decision.dispatcherHashAlgorithmOverride).toBeUndefined()
    expect(decision.dataSizeClass).toBe('rsa-3072')
  })

  it('does not apply mainnet workaround outside mainnet', () => {
    const decision = resolvePassportRegistrationPath({
      chainId: '7369',
      publicKeyAlgorithm: 'RSA',
      publicKeySizeBits: 2048,
      signatureAlgorithmOid: id_sha256WithRSAEncryption,
    })

    expect(decision.pathId).toBe('default-registration-path')
    expect(decision.dispatcherHashAlgorithmOverride).toBeUndefined()
  })
})
