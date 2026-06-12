import {
  babyJub,
  eddsa,
  ffUtils,
  Hex,
  Poseidon,
  poseidon,
  PublicKey,
  Signature,
} from '@iden3/js-crypto'
import { Buffer } from 'buffer'
import { useMemo } from 'react'
import { create } from 'zustand'
import { combine, createJSONStorage, persist } from 'zustand/middleware'

import { Config } from '@/config'
import { zustandSecureStorage } from '@/store/helpers'

const PRIVATE_KEY_HEX_PATTERN = /^[0-9a-fA-F]{64}$/

export const normalizePrivateKeyHex = (value: string): string => value.replace(/^0x/i, '')

export const deriveWalletAddressFromPrivateKey = (value: string): string | undefined => {
  const privateKeyHex = normalizePrivateKeyHex(value)
  if (!PRIVATE_KEY_HEX_PATTERN.test(privateKeyHex)) return undefined

  const skBuff = Hex.decodeString(privateKeyHex)
  const skBig = ffUtils.beBuff2int(skBuff)
  const point = babyJub.mulPointEScalar(babyJub.Base8, skBig) as [bigint, bigint]

  if (point[0] === 0n) return undefined

  const hash = poseidon.hash(point)
  return '0x' + Buffer.from(ffUtils.beInt2Buff(hash, 32)).toString('hex')
}

const useWalletStore = create(
  persist(
    combine(
      {
        privateKey: '',

        _hasHydrated: false,
      },
      set => ({
        setHasHydrated: (value: boolean) => {
          set({
            _hasHydrated: value,
          })
        },
        setPrivateKey: (value: string): void => {
          set({ privateKey: value })
        },
      }),
    ),
    {
      name: 'wallet',
      version: 1,
      storage: createJSONStorage(() => zustandSecureStorage),

      onRehydrateStorage: () => state => {
        state?.setHasHydrated(true)
      },

      partialize: state => ({ privateKey: state.privateKey }),
    },
  ),
)

const useGeneratePrivateKey = () => {
  return async () => {
    return babyJub.F.random().toString(16).padStart(64, '0')
  }
}

const usePublicKey = () => {
  const privateKeyHex = useWalletStore(state => state.privateKey)

  const skBuff = Hex.decodeString(privateKeyHex)
  const skBig = ffUtils.beBuff2int(skBuff)

  const point = babyJub.mulPointEScalar(babyJub.Base8, skBig)

  return new PublicKey(point)
}

const usePublicKeyHash = () => {
  const publicKey = usePublicKey()

  return useMemo(() => {
    const hash = poseidon.hash(publicKey.p)

    return ffUtils.beInt2Buff(hash, 32)
  }, [publicKey.p])
}

const usePointsNullifier = () => {
  return async (pkHex: string) => {
    const secretKey = BigInt(`0x${pkHex}`) % Poseidon.F.p

    const secretKeyHash = poseidon.hash([secretKey])

    const eventIDInt = BigInt(Config.POINTS_SVC_ID)

    return poseidon.hash([secretKey, secretKeyHash, eventIDInt])
  }
}

const useRegistrationChallenge = () => {
  const publicKeyHash = usePublicKeyHash()

  return useMemo(() => {
    return publicKeyHash.slice(-8)
  }, [publicKeyHash])
}

const useDeletePrivateKey = () => {
  const setPrivateKey = useWalletStore(state => state.setPrivateKey)

  return () => {
    return setPrivateKey('')
  }
}

// BN254 base field modulus (same reduction as babyJub.F.e() in js-crypto).
const BN254_FP = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
)

/**
 * useSignChallenge returns a function that signs a 32-byte challenge nonce with
 * the wallet's BabyJubjub private key using a custom EdDSA scheme.
 *
 * Why not eddsa.signPoseidon(privateKeyBytes)?
 *   The standard iden3 approach derives the effective private key via blake512(rawKey),
 *   which would produce a DIFFERENT public key than what the wallet exposes
 *   (Base8 * beBuff2int(rawKey)). We need the signature to be verifiable against
 *   the stored public key, so we skip the blake512 step.
 *
 * Algorithm (matches backend crypto.VerifyWalletSignature):
 *   sk   = beBuff2int(rawKeyBytes)
 *   msg  = nonceBigInt % BN254_FP           // reduce to Fp
 *   r    = poseidon([sk, msg]) % subOrder   // deterministic nonce (no randomness)
 *   R8   = Base8 * r
 *   hm   = poseidon([R8.x, R8.y, pk.x, pk.y, msg])
 *   S    = (r + 8 * hm * sk) % subOrder    // cofactor 8 to match iden3 VerifyPoseidon
 *   sig  = packSignature({R8, S})           // 64 bytes LE
 *
 * The cofactor multiplication is required because iden3's VerifyPoseidon checks
 * S*B8 == R8 + 8*hm*pk (cofactor on the hm*pk term).
 */
const useSignChallenge = () => {
  const privateKeyHex = useWalletStore(state => state.privateKey)
  const publicKey = usePublicKey()

  return async (nonceHex: string): Promise<string> => {
    const skBuff = Hex.decodeString(privateKeyHex)
    const sk = ffUtils.beBuff2int(skBuff)

    const nonceBytes = Buffer.from(nonceHex.replace(/^0x/, ''), 'hex')
    const nonceBig = ffUtils.beBuff2int(Buffer.from(nonceBytes))
    const msg = nonceBig % BN254_FP

    const subOrder = babyJub.subOrder as bigint
    const pkPoint = publicKey.p as [bigint, bigint]

    const rRaw = poseidon.hash([sk, msg]) as bigint
    const r = rRaw % subOrder

    const R8 = babyJub.mulPointEScalar(babyJub.Base8, r) as [bigint, bigint]
    const hm = poseidon.hash([R8[0], R8[1], pkPoint[0], pkPoint[1], msg]) as bigint
    // iden3 VerifyPoseidon checks S*B8 == R8 + 8*hm*pk, so include cofactor 8 here.
    const S = (r + ((8n * hm * sk) % subOrder)) % subOrder

    const packed = eddsa.packSignature(new Signature(R8, S))
    return '0x' + Buffer.from(packed).toString('hex')
  }
}

/**
 * useWalletAddress returns the wallet's address: "0x" + 32-byte BE hex of
 * poseidon([publicKey.x, publicKey.y]).
 * Mirrors: backend crypto.VerifyWalletAddress, and wallet.ts usePublicKeyHash.
 */
const useWalletAddress = () => {
  const privateKeyHex = useWalletStore(state => state.privateKey)
  return useMemo(() => deriveWalletAddressFromPrivateKey(privateKeyHex) ?? '', [privateKeyHex])
}

const useHasHydrated = () => useWalletStore(state => state._hasHydrated)

const useIsWalletReady = () => {
  const hasHydrated = useHasHydrated()
  const privateKey = useWalletStore(state => state.privateKey)
  return hasHydrated && privateKey !== ''
}

/**
 * Executes a wallet-domain operation without exposing the raw key through UI
 * props, component state, route params, logs, analytics, or return values.
 */
const withPrivateKey = async <T>(operation: (privateKey: string) => Promise<T>): Promise<T> => {
  const privateKey = useWalletStore.getState().privateKey
  if (!privateKey) throw new Error('Wallet is not ready')
  return operation(privateKey)
}

export const walletStore = {
  useWalletStore,

  useGeneratePrivateKey: useGeneratePrivateKey,
  usePointsNullifier: usePointsNullifier,
  useDeletePrivateKey,
  usePublicKey: usePublicKey,
  usePublicKeyHash,
  useRegistrationChallenge,
  useSignChallenge,
  useWalletAddress,
  useHasHydrated,
  useIsWalletReady,
  withPrivateKey,
}
