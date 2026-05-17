import { babyJub, eddsa, ffUtils, Hex, poseidon, PublicKey, Signature } from '@iden3/js-crypto'
import { Buffer } from 'buffer'
import { useCallback } from 'react'
import { Platform } from 'react-native'

import { registerWallet, requestWalletChallenge } from '@/api/modules/sso'
import { ssoStore } from '@/store/modules/sso'
import { walletStore } from '@/store/modules/wallet'

// BN254 base field modulus, mirroring wallet.ts.
const BN254_FP = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
)

/**
 * useWalletRegistration returns a `register` callback that:
 *  1. Skips if the *current* wallet address is already registered.
 *  2. Reads the current private key directly from the store at call time
 *     (avoids a stale-closure race where the hook captured publicKey/walletAddress
 *     before setPrivateKey() updated the store in the same tick).
 *  3. Requests a one-time challenge from the SSO service.
 *  4. Signs the challenge with the wallet's BabyJubjub private key.
 *  5. Posts the registration payload to the SSO service.
 *  6. Persists the registered address on success or HTTP 409 (already registered).
 *
 * Errors are logged but not thrown — registration is a background side-effect
 * and must not block the wallet creation UX.
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

      const walletSignature = await signChallenge(challenge)

      await registerWallet({
        walletAddress,
        publicKey: {
          x: '0x' + pkPoint[0].toString(16).padStart(64, '0'),
          y: '0x' + pkPoint[1].toString(16).padStart(64, '0'),
        },
        challenge,
        walletSignature,
        appAttestation: {},
      })

      setRegisteredAddress(walletAddress)
    } catch (err: unknown) {
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
