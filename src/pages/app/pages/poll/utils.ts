import { AbiCoder, toBeHex } from 'ethers'

import { ProposalsState } from '@/types/contracts/ProposalState'

import { ParsedContractProposal, Sex } from './types'

export const parseProposalFromContract = (
  proposal: ProposalsState.ProposalInfoStructOutput,
): ParsedContractProposal => {
  // votingWhitelistData is an array of bytes (one per voting contract)
  // We use the first one since we typically only have one voting contract
  const votingWhitelistDataArray = proposal[2][6]
  const rawWhitelistData =
    votingWhitelistDataArray.length > 0 ? votingWhitelistDataArray[0].toString() : ''

  const votingWhitelistData = rawWhitelistData ? decodeWhitelistData(rawWhitelistData) : null

  return {
    cid: proposal[2][4],
    status: Number(proposal[1]),
    startTimestamp: Number(proposal[2].startTimestamp),
    duration: Number(proposal[2].duration),
    voteResults: proposal[3].map(bigIntArray => bigIntArray.map(Number)),
    votingWhitelistData,
    rawProposal: proposal,
  }
}

export const decodeWhitelistData = (whitelistDataHex: string): DecodedWhitelistData => {
  const abiCoder = AbiCoder.defaultAbiCoder()
  const [_decodedData] = abiCoder.decode(
    ['tuple(uint256,uint256[],uint256,uint256,uint256,uint256,uint256,uint256)'],
    whitelistDataHex as `0x${string}`,
  )

  const decodedData: DecodedWhitelistData = {
    selector: _decodedData[0],
    nationalities: _decodedData[1].map((item: bigint) =>
      hexToAscii(toBeHex(item) as `0x${string}`),
    ),
    identityCreationTimestampUpperBound: Number(_decodedData[2]),
    identityCounterUpperBound: Number(_decodedData[3]),
    sex: hexToAscii(toBeHex(_decodedData[4]) as `0x${string}`) as Sex,
    birthDateLowerbound: toBeHex(_decodedData[5]),
    birthDateUpperbound: toBeHex(_decodedData[6]),
    expirationDateLowerBound: toBeHex(_decodedData[7]) as `0x${string}`,
  }

  return decodedData
}
export interface DecodedWhitelistData {
  selector: bigint
  nationalities: string[]
  identityCreationTimestampUpperBound: number
  identityCounterUpperBound: number
  sex: Sex
  birthDateLowerbound: string
  birthDateUpperbound: string
  expirationDateLowerBound: string
}

export const hexToAscii = (hex: string) => {
  const str = hex.replace(/^0x/, '')
  let result = ''
  for (let i = 0; i < str.length; i += 2) {
    result += String.fromCharCode(parseInt(str.slice(i, i + 2), 16))
  }
  return result
}
