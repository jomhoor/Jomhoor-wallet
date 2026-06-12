import { apiClient } from '@/api/client'

export const relayerRegister = async (callDataHex: string, destinationContractAddress: string) => {
  return apiClient.post<{
    data: {
      id: string
      type: 'txs'
      attributes: {
        tx_hash: string
      }
    }
  }>('/integrations/registration-relayer/v1/register', {
    data: {
      tx_data: callDataHex,
      destination: destinationContractAddress,
    },
  })
}

// The global response interceptor (src/api/interceptors.ts) deserializes JSON:API
// payloads with Jsona, which flattens `{ data: { attributes: { tx_hash } } }` into
// `{ tx_hash }`. Support both shapes so we are robust to interceptor behaviour.
export const extractRelayerTxHash = (data: unknown): string => {
  const payload = data as {
    tx_hash?: string
    data?: { attributes?: { tx_hash?: string } }
  }

  const txHash = payload?.tx_hash ?? payload?.data?.attributes?.tx_hash

  if (!txHash) {
    throw new TypeError('Relayer response did not contain a tx_hash')
  }

  return txHash
}
