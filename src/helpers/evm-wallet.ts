import { formatEther, JsonRpcProvider, Wallet } from 'ethers'
import { useMemo } from 'react'

import { RARIMO_CHAINS } from '@/api/modules/rarimo/constants'
import { Config } from '@/config'
import { walletStore } from '@/store'

/* ------------------------------------------------------------------ */
/*  Transaction history types                                          */
/* ------------------------------------------------------------------ */

export interface TransactionRecord {
  hash: string
  from: string
  to: string | null
  value: string // formatted in ether
  timestamp: number // unix seconds (0 if unknown)
  chainId: string
  direction: 'sent' | 'received'
  blockNumber: number
}

/* ------------------------------------------------------------------ */
/*  Supported chains                                                   */
/* ------------------------------------------------------------------ */

export interface ChainInfo {
  /** Unique key used in lookups */
  id: string
  /** Human-readable name */
  name: string
  /** Native token symbol */
  symbol: string
  /** JSON-RPC endpoint */
  rpc: string
  /** Ionicons icon name for the token */
  icon: string
}

/** All chains the wallet can display / transact on. */
export const WALLET_CHAINS: readonly ChainInfo[] = [
  {
    id: 'rarimo',
    name: 'Rarimo L2',
    symbol: 'RMO',
    rpc: RARIMO_CHAINS[Config.RMO_CHAIN_ID].rpcEvm,
    icon: 'globe-outline',
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    symbol: 'ETH',
    rpc: 'https://cloudflare-eth.com',
    icon: 'diamond-outline',
  },
] as const

export interface TokenBalance {
  chain: ChainInfo
  balance: string | null
  error?: boolean
}

/* ------------------------------------------------------------------ */
/*  Wallet derivation                                                  */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Providers & balance fetching                                       */
/* ------------------------------------------------------------------ */

/** Get a provider for a specific chain. */
export function getProvider(chain: ChainInfo): JsonRpcProvider {
  return new JsonRpcProvider(chain.rpc)
}

/** Get the RPC provider for the currently configured Rarimo chain. */
export function getRmoProvider(): JsonRpcProvider {
  return getProvider(WALLET_CHAINS[0])
}

/** Fetch the native balance on a single chain, formatted in ether. */
export async function fetchBalanceOnChain(address: string, chain: ChainInfo): Promise<string> {
  const provider = getProvider(chain)
  const raw = await provider.getBalance(address)
  return formatEther(raw)
}

/** Fetch the native balance (RMO) for the given address — legacy helper. */
export async function fetchBalance(address: string): Promise<string> {
  return fetchBalanceOnChain(address, WALLET_CHAINS[0])
}

/** Fetch balances across all supported chains in parallel. */
export async function fetchAllBalances(address: string): Promise<TokenBalance[]> {
  const results = await Promise.allSettled(
    WALLET_CHAINS.map(async chain => {
      const balance = await fetchBalanceOnChain(address, chain)
      return { chain, balance } as TokenBalance
    }),
  )

  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { chain: WALLET_CHAINS[i], balance: null, error: true },
  )
}

/** Truncate an address for display: 0x1234…abcd */
export function truncateAddress(address: string, chars = 6): string {
  if (!address) return ''
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`
}

/* ------------------------------------------------------------------ */
/*  Transaction history                                                */
/* ------------------------------------------------------------------ */

const SCAN_BLOCKS = 500 // number of recent blocks to scan per chain

/**
 * Scan recent blocks on a chain for transactions involving `address`.
 * Works well for low-traffic chains like Rarimo L2.
 * For high-traffic chains (Ethereum mainnet) the scan is limited to
 * avoid excessive RPC calls.
 */
export async function fetchRecentTransactions(
  address: string,
  chain: ChainInfo,
  maxBlocks = SCAN_BLOCKS,
): Promise<TransactionRecord[]> {
  const provider = getProvider(chain)
  const lowerAddr = address.toLowerCase()

  const latestBlock = await provider.getBlockNumber()
  const startBlock = Math.max(0, latestBlock - maxBlocks + 1)

  // For Ethereum mainnet, only scan a handful of blocks to stay fast
  const effectiveStart = chain.id === 'ethereum' ? Math.max(0, latestBlock - 10) : startBlock

  const txs: TransactionRecord[] = []

  // Scan blocks in parallel batches of 20
  const batchSize = 20
  for (let batchStart = effectiveStart; batchStart <= latestBlock; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize - 1, latestBlock)
    const blockPromises: Promise<void>[] = []

    for (let bn = batchStart; bn <= batchEnd; bn++) {
      blockPromises.push(
        provider
          .getBlock(bn, true)
          .then(block => {
            if (!block?.prefetchedTransactions) return
            for (const tx of block.prefetchedTransactions) {
              const fromMatch = tx.from?.toLowerCase() === lowerAddr
              const toMatch = tx.to?.toLowerCase() === lowerAddr
              if (!fromMatch && !toMatch) continue
              if (tx.value === 0n) continue // skip zero-value txns

              txs.push({
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: formatEther(tx.value),
                timestamp: block.timestamp,
                chainId: chain.id,
                direction: toMatch ? 'received' : 'sent',
                blockNumber: block.number,
              })
            }
          })
          .catch(() => {
            /* skip blocks that fail to fetch */
          }),
      )
    }

    await Promise.all(blockPromises)
  }

  // Sort newest first
  txs.sort((a, b) => b.blockNumber - a.blockNumber)
  return txs
}

/**
 * Fetch recent transactions across all wallet chains.
 * Results are merged and sorted by block number (newest first).
 */
export async function fetchAllTransactions(address: string): Promise<TransactionRecord[]> {
  const results = await Promise.allSettled(
    WALLET_CHAINS.map(chain => fetchRecentTransactions(address, chain)),
  )

  const merged: TransactionRecord[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') merged.push(...r.value)
  }

  merged.sort((a, b) => b.timestamp - a.timestamp || b.blockNumber - a.blockNumber)
  return merged
}
