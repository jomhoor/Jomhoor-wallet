import { Env } from '@env'

import type { ChainInfo } from './types'

enum RarimoChains {
  Mainnet = '7368',
  Testnet = '7369',
  LocalHardhat = '31337',
}

// Local RPC URL - uses env var if available, otherwise defaults to localhost
// For device testing, replace with your Mac's IP: http://192.168.x.x:8545
const LOCAL_RPC_URL = Env.LOCAL_RPC_URL || 'http://localhost:8545'

export const RARIMO_CHAINS: Record<string, ChainInfo> = {
  [RarimoChains.Testnet]: {
    chainId: '7369',
    chainName: 'Rarimo L2 Testnet',
    chainSymbolImageUrl:
      'https://raw.githubusercontent.com/rarimo/js-sdk/2.0.0-rc.14/assets/logos/ra-dark-logo.png',
    rpcEvm: 'https://l2.testnet.rarimo.com',
    explorerUrl: 'https://scan.testnet.rarimo.com',
  },
  [RarimoChains.Mainnet]: {
    chainId: '7368',
    chainName: 'Rarimo Mainnet',
    chainSymbolImageUrl:
      'https://raw.githubusercontent.com/rarimo/js-sdk/2.0.0-rc.14/assets/logos/ra-dark-logo.png',

    rpcEvm: 'https://l2.rarimo.com',
    explorerUrl: 'https://scan.rarimo.com',
  },
  [RarimoChains.LocalHardhat]: {
    chainId: '31337',
    chainName: 'Local Hardhat',
    chainSymbolImageUrl:
      'https://raw.githubusercontent.com/rarimo/js-sdk/2.0.0-rc.14/assets/logos/ra-dark-logo.png',
    rpcEvm: LOCAL_RPC_URL,
    explorerUrl: '', // No explorer for local
  },
}
