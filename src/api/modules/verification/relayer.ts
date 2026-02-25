import { apiClient } from '@/api/client'

export class AlreadyVotedError extends Error {
  constructor(message = 'You have already voted on this proposal') {
    super(message)
    this.name = 'AlreadyVotedError'
  }
}

export const relayerVote = async (callDataHex: string, destinationContractAddress: string) => {
  console.log('[relayerVote] Sending vote request...')
  console.log('[relayerVote] Destination:', destinationContractAddress)
  console.log('[relayerVote] CallData length:', callDataHex.length)
  console.log('[relayerVote] CallData first 100:', callDataHex.substring(0, 100))

  try {
    const result = await apiClient.post<{
      id: string
      type: 'txs'
      tx_hash: string
    }>('/integrations/proof-verification-relayer/v3/vote', {
      data: {
        attributes: {
          tx_data: callDataHex,
          destination: destinationContractAddress,
        },
      },
    })
    console.log('[relayerVote] Success! tx_hash:', result.data)
    return result
  } catch (error: any) {
    console.log('[relayerVote] Error:', error.message)
    console.log('[relayerVote] Response status:', error.response?.status)
    console.log('[relayerVote] Response data:', JSON.stringify(error.response?.data))

    // Check for "key already exists" error (double voting)
    const errorData = error.response?.data
    if (errorData?.errors) {
      const errorMeta = errorData.errors[0]?.meta
      if (
        errorMeta?.error?.includes('the key already exists') ||
        errorMeta?.field?.includes('SparseMerkleTree')
      ) {
        console.log('[relayerVote] Detected double-vote error!')
        throw new AlreadyVotedError()
      }
    }

    throw error
  }
}
