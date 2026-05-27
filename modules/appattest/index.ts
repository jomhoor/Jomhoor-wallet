import { requireNativeModule } from 'expo-modules-core'

const AppAttestNative = requireNativeModule('AppAttest')

/**
 * Generates a new App Attest key pair on iOS (DCAppAttestService.generateKey).
 * On Android this always rejects with NOT_AVAILABLE — use getPlayIntegrityToken instead.
 *
 * @returns base64-encoded key identifier string.
 */
export async function generateKey(): Promise<string> {
  return AppAttestNative.generateKey()
}

/**
 * Attests the key on iOS (DCAppAttestService.attestKey).
 * On Android this always rejects with NOT_AVAILABLE.
 *
 * @param keyId              base64-encoded key ID returned by generateKey()
 * @param clientDataHashBase64 base64-encoded SHA-256 of the challenge bytes
 * @returns base64-encoded CBOR attestation object.
 */
export async function attestKey(keyId: string, clientDataHashBase64: string): Promise<string> {
  return AppAttestNative.attestKey(keyId, clientDataHashBase64)
}

/**
 * Requests a Play Integrity token on Android (IntegrityManager.requestIntegrityToken).
 * On iOS this always rejects with NOT_AVAILABLE.
 *
 * @param nonce base64-encoded nonce string (base64(SHA-256(challengeBytes)))
 * @returns Play Integrity token string.
 */
export async function getPlayIntegrityToken(nonce: string): Promise<string> {
  return AppAttestNative.getPlayIntegrityToken(nonce)
}
