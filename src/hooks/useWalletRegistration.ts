import { babyJub, eddsa, ffUtils, Hex, poseidon, PublicKey, Signature } from '@iden3/js-crypto'
import * as AppAttest from '@modules/appattest'
import { sha256 } from '@noble/hashes/sha256'
import { Buffer } from 'buffer'
import { useCallback } from 'react'
import { Platform } from 'react-native'

import { registerWallet, requestWalletChallenge } from '@/api/modules/sso'
import { getStorageItemAsync, setStorageItemAsync } from '@/core/secure-store'
import { ssoStore } from '@/store/modules/sso'
import { walletStore } from '@/store/modules/wallet'

// BN254 base field modulus, mirroring wallet.ts.
const BN254_FP = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
)

const APPATTEST_KEY_STORAGE_KEY = 'appattest_key_id'

/**
 * Thrown when the device does not support the required attestation mechanism
 * (DCAppAttestService on iOS, Play Integrity on Android). The caller should
 * surface a "Device Not Supported" screen; do NOT swallow this error.
 */
export class AttestationNotSupportedError extends Error {
  constructor(platform: string, cause?: unknown) {
    super(`App attestation is not supported on this ${platform} device`)
    this.name = 'AttestationNotSupportedError'
    if (cause instanceof Error) {
      this.stack = this.stack + '\nCaused by: ' + cause.stack
    }
  }
}

/**
 * Builds the appAttestation payload for the current platform.
 * Throws AttestationNotSupportedError if the device cannot perform attestation.
 */
export async function collectAttestation(challengeHex: string): Promise<Record<string, string>> {
  const challengeBytes = Buffer.from(challengeHex.replace(/^0x/, ''), 'hex')

  if (Platform.OS === 'ios') {
    // Reuse the stored key ID so each device uses the same key across sessions.
    let keyId = await getStorageItemAsync(APPATTEST_KEY_STORAGE_KEY)
    if (!keyId) {
      try {
        keyId = await AppAttest.generateKey()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('NOT_AVAILABLE') || msg.includes('not supported')) {
          throw new AttestationNotSupportedError('iOS', err)
        }
        throw err
      }
      await setStorageItemAsync(APPATTEST_KEY_STORAGE_KEY, keyId)
    }

    // clientDataHash = SHA-256(challengeBytes) — this is what the server verifies.
    const clientDataHash = sha256(challengeBytes)
    const clientDataHashB64 = Buffer.from(clientDataHash).toString('base64')

    let attestation: string
    try {
      attestation = await AppAttest.attestKey(keyId, clientDataHashB64)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('NOT_AVAILABLE') || msg.includes('not supported')) {
        throw new AttestationNotSupportedError('iOS', err)
      }
      throw err
    }

    return { keyId, attestation }
  } else {
    // Android: nonce = base64(SHA-256(challengeBytes))
    const nonce = Buffer.from(sha256(challengeBytes)).toString('base64')
    let token: string
    try {
      token = await AppAttest.getPlayIntegrityToken(nonce)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('NOT_AVAILABLE') || msg.includes('not supported')) {
        throw new AttestationNotSupportedError('Android', err)
      }
      throw err
    }
    return { token }
  }
}

/**
 * useWalletRegistration returns a `register` callback that:
 *  1. Skips if the *current* wallet address is already registered.
 *  2. Reads the current private key directly from the store at call time
 *     (avoids a stale-closure race where the hook captured publicKey/walletAddress
 *     before setPrivateKey() updated the store in the same tick).
 *  3. Requests a one-time challenge from the SSO service.
 *  4. Collects platform attestation (iOS App Attest / Android Play Integrity).
 *  5. Signs the challenge with the wallet's BabyJubjub private key.
 *  6. Posts the registration payload to the SSO service.
 *  7. Persists the registered address on success or HTTP 409 (already registered).
 *
 * AttestationNotSupportedError is NOT swallowed — callers must handle it by
 * showing the DeviceNotSupported screen. All other errors are logged but
 * not thrown — registration is a background side-effect and must not block
 * the wallet creation UX.
 */
export function useWalletRegistration() {
  const { registeredAddress, setRegisteredAddress } = ssoStore.useSsoStore()

  const register = useCallback(async () => {
    // Read private key lazily from the store so we always see the freshly-set
    // value even when this is called immediately after setPrivateKey().
    const privateKeyHex = walletStore.useWalletStore.getState().privateKey
    if (!privateKeyHex) {
      console.warn('[useWalletRegistration] skipping: no private key in store')
      return
    }

    // Derive public key, wallet address, and signing primitives from the
    // current private key — not from a stale React closure.
    const skBuff = Hex.decodeString(privateKeyHex)
    const sk = ffUtils.beBuff2int(skBuff)
    const point = babyJub.mulPointEScalar(babyJub.Base8, sk) as [bigint, bigint]
    const publicKey = new PublicKey(point)
    const pkPoint = publicKey.p as [bigint, bigint]

    if (pkPoint[0] === 0n) {
      console.warn('[useWalletRegistration] skipping: identity-point public key (sk=0)')
      return
    }

    const addressHash = poseidon.hash(pkPoint)
    const walletAddress = '0x' + Buffer.from(ffUtils.beInt2Buff(addressHash, 32)).toString('hex')

    // Skip only if THIS exact address is already registered. After a reinstall the
    // Keychain-backed privateKey can regenerate while the MMKV-backed flag persists
    // (or vice versa); comparing addresses prevents that desync.
    if (registeredAddress === walletAddress) return

    const signChallenge = async (nonceHex: string): Promise<string> => {
      const nonceBytes = Buffer.from(nonceHex.replace(/^0x/, ''), 'hex')
      const nonceBig = ffUtils.beBuff2int(Buffer.from(nonceBytes))
      const msg = nonceBig % BN254_FP

      const subOrder = babyJub.subOrder as bigint
      const rRaw = poseidon.hash([sk, msg]) as bigint
      const r = rRaw % subOrder
      const R8 = babyJub.mulPointEScalar(babyJub.Base8, r) as [bigint, bigint]
      const hm = poseidon.hash([R8[0], R8[1], pkPoint[0], pkPoint[1], msg]) as bigint
      const S = (r + ((8n * hm * sk) % subOrder)) % subOrder

      const packed = eddsa.packSignature(new Signature(R8, S))
      return '0x' + Buffer.from(packed).toString('hex')
    }

    const platform = Platform.OS === 'ios' ? 'ios' : 'android'

    try {
      const { data: challengeData } = await requestWalletChallenge(platform)
      const { challenge } = challengeData

      // Collect platform attestation — throws AttestationNotSupportedError if
      // the device does not support it. Let that propagate to the caller.
      const appAttestation = await collectAttestation(challenge)

      const walletSignature = await signChallenge(challenge)

      await registerWallet({
        walletAddress,
        publicKey: {
          x: '0x' + pkPoint[0].toString(16).padStart(64, '0'),
          y: '0x' + pkPoint[1].toString(16).padStart(64, '0'),
        },
        challenge,
        walletSignature,
        appAttestation,
      })

      setRegisteredAddress(walletAddress)
    } catch (err: unknown) {
      // AttestationNotSupportedError must propagate — don't swallow it.
      if (err instanceof AttestationNotSupportedError) throw err

      // HTTP 409 means the wallet is already registered — treat as success.
      if (isAxiosError(err) && err.response?.status === 409) {
        setRegisteredAddress(walletAddress)
        return
      }
      // Non-fatal: log and let the app continue. Registration will be retried on next launch.
      console.warn('[useWalletRegistration] registration failed:', err)
    }
  }, [registeredAddress, setRegisteredAddress])

  return { register }
}

// Minimal Axios error shape check (avoids importing axios just for the type).
function isAxiosError(err: unknown): err is { response?: { status: number } } {
  return typeof err === 'object' && err !== null && 'response' in err
}
