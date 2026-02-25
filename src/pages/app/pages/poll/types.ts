import { ProposalsState } from '@/types/contracts/ProposalState'

export interface ParsedContractProposal {
  cid: string
  status: ProposalStatus
  startTimestamp: number
  duration: number
  voteResults: number[][]
  votingWhitelistData: DecodedWhitelistData | null
  rawProposal: ProposalsState.ProposalInfoStructOutput
}
export interface ProposalMetadata {
  title: string
  description: string
  imageCid?: string
  acceptedOptions: QuestionIpfs[]
}
export interface QuestionIpfs {
  title: string
  variants: string[]
}
export enum Sex {
  Male = 'M',
  Female = 'F',
  Any = '',
}
export enum ProposalStatus {
  None,
  Waiting,
  Started,
  Ended,
  DoNotShow,
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
