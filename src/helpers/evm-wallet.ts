import { formatEther, JsonRpcProvider, Wallet } from 'ethers'
import { useMemo } from 'react'

import { RARIMO_CHAINS } from '@/api/modules/rarimo/constants'
import { Config } from '@/config'
import { walletStore } from '@/store'

/**
 * Derive an EVM wallet from the existing BabyJubjub private key.
 *
 * The BJJ secret scalar is 254 bits stored as a 64-char hex string.
 * Any 32-byte value below the secp256k1 curve order is a valid private key,
 * and BJJ field elements always satisfy that constraint.
 *
 * Rarime (the reference Rarimo app) uses the same approach:
 * `Credentials.create(bjjPrivateKey)`.
 *
 * Privacy: the secp256k1 public key is on a completely different curve
 * than the BJJ public key, so they are cryptographically unlinkable even
 * though they share the same secret scalar.
 */
export function deriveEvmWallet(bjjPrivateKeyHex: string): Wallet | null {
  if (!bjjPrivateKeyHex) return null
  try {
    return new Wallet(`0x${bjjPrivateKeyHex}`)
  } catch {
    return null
  }
}

/** React hook – returns an ethers.Wallet derived from the stored BJJ key. */
export const useEvmWallet = (): Wallet | null => {
  const privateKeyHex = walletStore.useWalletStore(state => state.privateKey)

  return useMemo(() => deriveEvmWallet(privateKeyHex), [privateKeyHex])
}

/** React hook – returns the EVM address string (or null). */
export const useEvmAddress = (): string | null => {
  const wallet = useEvmWallet()
  return wallet?.address ?? null
}

/** Get the RPC provider for the currently configured Rarimo chain. */
export function getRmoProvider(): JsonRpcProvider {
  return new JsonRpcProvider(RARIMO_CHAINS[Config.RMO_CHAIN_ID].rpcEvm)
}

/** Fetch the native balance (RMO) for the given address, formatted in ether. */
export async function fetchBalance(address: string): Promise<string> {
  const provider = getRmoProvider()
  const raw = await provider.getBalance(address)
  return formatEther(raw)
}

/** Truncate an address for display: 0x1234…abcd */
export function truncateAddress(address: string, chars = 6): string {
  if (!address) return ''
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`
}
