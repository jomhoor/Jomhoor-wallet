import { NoirCircuitParams, NoirZKProof } from '@modules/noir'
import { AbiCoder, JsonRpcProvider, keccak256, toBeHex, toBigInt, zeroPadValue } from 'ethers'
import { Platform } from 'react-native'

import { RARIMO_CHAINS } from '@/api/modules/rarimo'
import { relayerVote } from '@/api/modules/verification/relayer'
import { Config } from '@/config'
import { createBioPassportVotingContract, createPoseidonSMTContract } from '@/helpers'
import {
  MAX_DATE_HEX,
  MAX_UINT_32_HEX,
  PRIME,
  ZERO_DATE_HEX,
} from '@/pages/app/pages/poll/constants'
import { DecodedWhitelistData } from '@/pages/app/pages/poll/types'
import { NoirEpassportIdentity } from '@/store/modules/identity/Identity'
import { ProposalState } from '@/types/contracts'
import { SparseMerkleTree } from '@/types/contracts/PoseidonSMT'
import { computeCitizenshipMask } from '@/utils/citizenship-mask'

import { QueryProofParams } from './types/QueryIdentity'

const DEFAULT_MASK_HEX = computeCitizenshipMask(['IRN'])

export class PassportBasedQueryIdentityCircuit {
  public circuitParams: NoirCircuitParams
  public currentIdentity: NoirEpassportIdentity
  public proposalContract: ProposalState
  public votingContractAddress: string

  private _passportRegistrationProof?: SparseMerkleTree.ProofStructOutput

  constructor(
    identity: NoirEpassportIdentity,
    proposalContract: ProposalState,
    votingContractAddress: string,
  ) {
    this.currentIdentity = identity
    this.circuitParams = NoirCircuitParams.fromName('queryIdentity')
    this.proposalContract = proposalContract
    this.votingContractAddress = votingContractAddress
  }

  public static get rmoProvider() {
    return new JsonRpcProvider(RARIMO_CHAINS[Config.RMO_CHAIN_ID].rpcEvm)
  }

  public get bioPassportVotingContract() {
    return createBioPassportVotingContract(
      this.votingContractAddress,
      PassportBasedQueryIdentityCircuit.rmoProvider,
    )
  }

  public static get registrationPoseidonSMTContract() {
    return createPoseidonSMTContract(
      Config.REGISTRATION_POSEIDON_SMT_CONTRACT_ADDRESS,
      PassportBasedQueryIdentityCircuit.rmoProvider,
    )
  }

  async prove(
    params: Partial<QueryProofParams>,
    proofType: 'plonk' | 'honk_keccak' = 'honk_keccak',
  ) {
    console.log('[PassportBasedQueryIdentityCircuit] prove() called')

    const [byteCode, setupUri] = await Promise.all([
      this.circuitParams.downloadByteCode(),
      NoirCircuitParams.getTrustedSetupUri(),
    ])

    if (!setupUri) {
      throw new Error('Trusted setup URI missing')
    }

    const currentIdentity = this.currentIdentity

    if (!(currentIdentity instanceof NoirEpassportIdentity)) {
      throw new Error('Identity is not NoirEpassportIdentity')
    }

    const passportProofIndexHex = await currentIdentity.getPassportProofIndex(
      currentIdentity.identityKey,
      currentIdentity.pkIdentityHash,
    )
    console.log('[PassportBasedQueryIdentityCircuit] passportProofIndexHex:', passportProofIndexHex)

    const passportRegistrationProof =
      await currentIdentity.getPassportRegistrationProof(passportProofIndexHex)

    const registrationRoot = passportRegistrationProof.root?.toString() ?? '0'
    if (BigInt(registrationRoot) === 0n) {
      throw new Error(
        'Passport is not registered on the current chain. Re-register after resetting Hardhat.',
      )
    }

    this._passportRegistrationProof = passportRegistrationProof

    const dg1 = Array.from(currentIdentity.document.dg1Bytes).map(String)
    if (dg1.length !== 93) {
      throw new Error(`Passport queryIdentity expects DG1 to be 93 bytes, got ${dg1.length}`)
    }

    const siblingsAsStrings = passportRegistrationProof.siblings.map((s: bigint | string) =>
      s.toString(),
    )

    const inputs = this._normalizeQueryProofParams({
      idStateRoot: registrationRoot,
      dg1,
      pkPassportHash: this._ensureHexPrefix(currentIdentity.identityKey),
      siblings: siblingsAsStrings,
      ...params,
    })
    console.log('[PassportBasedQueryIdentityCircuit] Normalized inputs:', JSON.stringify(inputs))

    const proof = await this.circuitParams.prove(JSON.stringify(inputs), byteCode, proofType)
    if (!proof) {
      throw new Error(`Proof generation failed for circuit ${this.circuitParams.name}`)
    }

    return proof
  }

  async submitVote({
    proof,
    votes,
    proposalId,
  }: {
    proof: NoirZKProof
    votes: number[]
    proposalId: string
  }) {
    const abiCoder = new AbiCoder()
    const userDataEncoded = abiCoder.encode(
      ['uint256', 'uint256[]', 'tuple(uint256,uint256,uint256)'],
      [
        proposalId,
        votes.map(v => 1 << Number(v)),
        ['0x' + proof.pub_signals[0], '0x' + proof.pub_signals[6], '0x' + proof.pub_signals[15]],
      ],
    )

    if (!this._passportRegistrationProof) {
      throw new Error("Passport registration proof doesn't exist")
    }

    const callDataHex = this.bioPassportVotingContract.contractInterface.encodeFunctionData(
      'executeNoir',
      [
        this._passportRegistrationProof.root as string,
        '0x' + proof.pub_signals[13],
        userDataEncoded,
        '0x' + proof.proof,
      ],
    )

    await relayerVote(callDataHex, this.votingContractAddress)
  }

  async getEventId(proposalId: string) {
    return await this.proposalContract.getProposalEventId(proposalId)
  }

  async getPassportInfo() {
    const [passportInfo_, identityInfo_] = await this.currentIdentity.getPassportInfo()
    return {
      identityCounter: passportInfo_.identityReissueCounter,
      timestamp: identityInfo_.issueTimestamp,
    }
  }

  async getVotingBounds({
    whitelistData,
    timestamp,
    identityCounter,
  }: {
    whitelistData: DecodedWhitelistData
    timestamp: bigint
    identityCounter: bigint
  }) {
    const ROOT_VALIDITY = BigInt(
      await PassportBasedQueryIdentityCircuit.registrationPoseidonSMTContract.contractInstance.ROOT_VALIDITY(),
    )
    const timestampUpper = BigInt(whitelistData.identityCreationTimestampUpperBound) - ROOT_VALIDITY

    if (timestamp > 0n) {
      if (timestamp > timestampUpper) {
        throw new Error('Identity was registered after the voting deadline')
      }

      const identityCountUpper = BigInt(whitelistData.identityCounterUpperBound)
      if (identityCounter > identityCountUpper) {
        throw new Error('Identity registered more than allowed, after voting start')
      }

      return { timestampUpper, identityCountUpper }
    }

    return { timestampUpper, identityCountUpper: BigInt(MAX_UINT_32_HEX) }
  }

  getEventData(votes: number[]): string {
    const abiCoder = AbiCoder.defaultAbiCoder()
    const encoded = abiCoder.encode(['uint256[]'], [votes.map(v => 1 << v)])
    const hashHex = keccak256(encoded)
    const hashBn = toBigInt(hashHex)
    const mask = (BigInt(1) << BigInt(248)) - BigInt(1)
    const truncated = hashBn & mask

    return zeroPadValue(toBeHex(truncated), 32)
  }

  private _normalizeQueryProofParams(params: QueryProofParams = {}) {
    const useHex = Platform.OS === 'android'
    const toHex = (v: string) => this._ensureHexPrefix(BigInt(v).toString(16))
    const toDec = (v: string) => BigInt(v).toString(10)
    const fmt = (v: string | undefined, def: string) => (useHex ? toHex(v ?? def) : toDec(v ?? def))

    const formatArray = (arr: string[] = []) =>
      arr.map(item =>
        useHex ? this._ensureHexPrefix(BigInt(item).toString(16)) : BigInt(item).toString(10),
      )

    return {
      event_id: fmt(params.eventId, this._getRandomHex()),
      event_data: fmt(params.eventData, this._getRandomDecimal()),
      id_state_root: fmt(params.idStateRoot, '0'),
      selector: fmt(params.selector, '262143'),
      current_date: fmt(params.currentDate, ZERO_DATE_HEX),
      timestamp_lowerbound: fmt(params.timestampLower, '0'),
      timestamp_upperbound: fmt(params.timestampUpper, PRIME.toString()),
      identity_count_lowerbound: fmt(params.identityCountLower, '0'),
      identity_count_upperbound: fmt(params.identityCountUpper, PRIME.toString()),
      birth_date_lowerbound: fmt(params.birthDateLower, ZERO_DATE_HEX),
      birth_date_upperbound: fmt(params.birthDateUpper, MAX_DATE_HEX),
      expiration_date_lowerbound: fmt(params.expirationDateLower, ZERO_DATE_HEX),
      expiration_date_upperbound: fmt(params.expirationDateUpper, MAX_DATE_HEX),
      citizenship_mask: fmt(params.citizenshipMask, DEFAULT_MASK_HEX),
      sk_identity: fmt(params.skIdentity, '0'),
      pk_passport_hash: fmt(params.pkPassportHash, '0'),
      dg1: formatArray(params.dg1),
      siblings: formatArray(params.siblings),
      timestamp: fmt(params.timestamp, '0'),
      identity_counter: fmt(params.identityCounter, '0'),
    }
  }

  private _ensureHexPrefix(val: string): string {
    return val.startsWith('0x') ? val : `0x${val}`
  }

  private _getRandomDecimal(bits = 250): string {
    const rand = this._randomBigInt(bits)
    return (rand % BigInt(PRIME)).toString(10)
  }

  private _getRandomHex(bits = 250): string {
    const rand = this._randomBigInt(bits)
    return this._ensureHexPrefix((rand % BigInt(PRIME)).toString(16))
  }

  private _randomBigInt(bits: number): bigint {
    const bytes = Math.ceil(bits / 8)
    const arr = new Uint8Array(bytes)
    crypto.getRandomValues(arr)
    return BigInt(
      '0x' +
        Array.from(arr)
          .map(b => b.toString(16).padStart(2, '0'))
          .join(''),
    )
  }
}
