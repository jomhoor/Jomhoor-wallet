import { poseidon } from '@iden3/js-crypto'
import { NoirCircuitParams, NoirZKProof } from '@modules/noir'
import { AsnConvert } from '@peculiar/asn1-schema'
import { AbiCoder, JsonRpcProvider, keccak256, toBeHex, toBigInt, zeroPadValue } from 'ethers'
import { Platform } from 'react-native'

import { RARIMO_CHAINS } from '@/api/modules/rarimo'
import { relayerVote } from '@/api/modules/verification/relayer'
import { Config } from '@/config'
import { createNoirIdVotingContract, createPoseidonSMTContract } from '@/helpers'
import {
  MAX_DATE_HEX,
  MAX_UINT_32_HEX,
  PRIME,
  ZERO_DATE_HEX,
} from '@/pages/app/pages/poll/constants'
import { DecodedWhitelistData } from '@/pages/app/pages/poll/types'
import { NoirEIDIdentity } from '@/store/modules/identity/Identity'
import { ProposalState } from '@/types/contracts'
import { SparseMerkleTree } from '@/types/contracts/PoseidonSMT'
import { INID_MASKS } from '@/utils/citizenship-mask'

import { QueryProofParams } from './types/QueryIdentity'

// INID circuit uses 2-letter country codes (e.g., 'IR' not 'IRN')
// The citizenship_check uses a different country array with 238 entries
// Iran (IR = 18770) is at index 101, so bit 101 must be set
const DEFAULT_MASK_HEX = INID_MASKS.IRAN

/**
 * Compute dg1_commitment matching Noir's algorithm:
 * 1. Split dg1[108] into 4 chunks of 27 bytes each
 * 2. Each chunk is little-endian Field (bytes at lower indices have smaller exponents)
 * 3. Hash: poseidon(chunk0, chunk1, chunk2, chunk3, poseidon(sk_identity))
 */
function computeDg1Commitment(dg1: Uint8Array, skIdentity: bigint): string {
  if (dg1.length !== 108) {
    throw new Error(`dg1 must be 108 bytes, got ${dg1.length}`)
  }

  // Split into 4 chunks of 27 bytes each, convert to little-endian bigints
  const chunks: bigint[] = [0n, 0n, 0n, 0n]
  let current = 1n

  // Noir algorithm:
  // for i in 0..27 {
  //     for ii in 0..4 {
  //         dg1_chunks[ii] += current * dg1[ii * 27 + i] as Field;
  //     }
  //     current *= 256;
  // }
  for (let i = 0; i < 27; i++) {
    for (let ii = 0; ii < 4; ii++) {
      chunks[ii] += current * BigInt(dg1[ii * 27 + i])
    }
    current *= 256n
  }

  console.log('[computeDg1Commitment] Chunks:')
  for (let i = 0; i < 4; i++) {
    console.log(`  chunk[${i}]: ${chunks[i].toString(16)}`)
  }

  // Hash sk_identity first
  const skIdentityHash = poseidon.hash([skIdentity])
  console.log('[computeDg1Commitment] poseidon(sk_identity):', skIdentityHash.toString(16))

  // Hash all 5 values: chunks[0..4] + poseidon(sk_identity)
  const dg1Commitment = poseidon.hash([chunks[0], chunks[1], chunks[2], chunks[3], skIdentityHash])
  const hexResult = dg1Commitment.toString(16).padStart(64, '0')
  console.log('[computeDg1Commitment] dg1_commitment:', hexResult)

  return hexResult
}

/**
 * Builds and proves the Query Identity circuit.
 */
export class EIDBasedQueryIdentityCircuit {
  public circuitParams: NoirCircuitParams
  public currentIdentity: NoirEIDIdentity
  public proposalContract: ProposalState

  private _passportRegistrationProof?: SparseMerkleTree.ProofStructOutput

  constructor(identity: NoirEIDIdentity, proposalContract: ProposalState) {
    this.currentIdentity = identity
    this.circuitParams = NoirCircuitParams.fromName('queryIdentity_inid_ca')
    this.proposalContract = proposalContract
  }

  public static get rmoProvider() {
    return new JsonRpcProvider(RARIMO_CHAINS[Config.RMO_CHAIN_ID].rpcEvm)
  }

  public static get noirIdVotingContract() {
    return createNoirIdVotingContract(
      Config.NOIR_ID_VOTING_CONTRACT,
      EIDBasedQueryIdentityCircuit.rmoProvider,
    )
  }

  public static get registrationPoseidonSMTContract() {
    return createPoseidonSMTContract(
      Config.REGISTRATION_POSEIDON_SMT_CONTRACT_ADDRESS,
      EIDBasedQueryIdentityCircuit.rmoProvider,
    )
  }

  /**
   * Generates a ZK proof given serialized inputs.
   */
  async prove(params: Partial<QueryProofParams>) {
    console.log(
      '[EIDBasedQueryIdentityCircuit] prove() called with params:',
      JSON.stringify(params),
    )

    const [byteCode, setupUri] = await Promise.all([
      this.circuitParams.downloadByteCode(),
      NoirCircuitParams.getTrustedSetupUri(),
    ])
    console.log(
      '[EIDBasedQueryIdentityCircuit] ByteCode length:',
      byteCode?.length,
      'SetupUri:',
      setupUri,
    )

    if (!setupUri) {
      throw new Error('Trusted setup URI missing')
    }

    const currentIdentity = this.currentIdentity

    if (!(currentIdentity instanceof NoirEIDIdentity))
      throw new Error('Identity is not NoirEIDIdentity')

    console.log('[EIDBasedQueryIdentityCircuit] Getting rawTbsCertBytes...')
    const rawTbsCertBytes = new Uint8Array(
      AsnConvert.serialize(currentIdentity.document.sigCertificate.certificate.tbsCertificate),
    )
    console.log('[EIDBasedQueryIdentityCircuit] rawTbsCertBytes length:', rawTbsCertBytes.length)

    console.log('[EIDBasedQueryIdentityCircuit] Getting passportProofIndexHex...')
    const passportProofIndexHex = await currentIdentity.getPassportProofIndex(
      currentIdentity.identityKey, // passport hash  (passportKey)
      currentIdentity.pkIdentityHash, // registrationProof.pub_signals[3] (IdentityKey)
    )
    console.log('[EIDBasedQueryIdentityCircuit] passportProofIndexHex:', passportProofIndexHex)

    console.log('[EIDBasedQueryIdentityCircuit] Getting passportRegistrationProof...')
    const passportRegistrationProof =
      await currentIdentity.getPassportRegistrationProof(passportProofIndexHex)

    // === DEBUG: Examine raw siblings from contract ===
    const rawSiblings = passportRegistrationProof.siblings
    console.log('[EIDBasedQueryIdentityCircuit] === RAW SIBLINGS DEBUG ===')
    console.log('  Type of siblings array:', typeof rawSiblings, Array.isArray(rawSiblings))
    console.log('  Siblings length:', rawSiblings?.length)
    if (rawSiblings && rawSiblings.length > 0) {
      console.log('  Type of first sibling:', typeof rawSiblings[0])
      console.log('  First sibling raw value:', rawSiblings[0])
      console.log('  First sibling toString():', rawSiblings[0]?.toString())
      console.log(
        '  First 5 siblings raw:',
        rawSiblings.slice(0, 5).map((s: unknown) => String(s)),
      )
      // Check if any are non-zero by comparing to various zero representations
      const nonZeroCount = rawSiblings.filter((s: unknown) => {
        const strVal = String(s)
        return strVal !== '0' && strVal !== '0x0' && strVal !== '0x00' && BigInt(strVal) !== 0n
      }).length
      console.log('  Non-zero siblings (strict check):', nonZeroCount)
    }
    // === END DEBUG ===

    console.log(
      '[EIDBasedQueryIdentityCircuit] passportRegistrationProof:',
      JSON.stringify({
        root: passportRegistrationProof.root?.toString(),
        existence: passportRegistrationProof.existence,
        key: passportRegistrationProof.key?.toString(),
        value: passportRegistrationProof.value?.toString(),
        siblingsLength: passportRegistrationProof.siblings?.length,
        siblingsNonZero: passportRegistrationProof.siblings?.filter(
          (s: { toString: () => string }) => s.toString() !== '0',
        ).length,
      }),
    )

    this._passportRegistrationProof = passportRegistrationProof

    // Log the stored dg1Commitment from registration for comparison
    console.log('[EIDBasedQueryIdentityCircuit] === REGISTRATION VALUES (stored on-chain) ===')
    console.log('  passportHash:', currentIdentity.passportHash)
    console.log('  pkIdentityHash:', currentIdentity.pkIdentityHash)
    console.log('  dg1Commitment (from registration):', currentIdentity.dg1Commitment)
    console.log('  identityKey:', currentIdentity.identityKey)

    // Log the SMT value that was stored (poseidon(dg1_commit, identity_counter, timestamp))
    console.log('[EIDBasedQueryIdentityCircuit] === SMT PROOF ===')
    console.log('  SMT root:', passportRegistrationProof.root?.toString())
    console.log('  SMT existence:', passportRegistrationProof.existence)
    console.log('  SMT key (tree_position):', passportRegistrationProof.key?.toString())
    console.log('  SMT value (stored):', passportRegistrationProof.value?.toString())

    const dg1 = Array.from(this.getDg1(rawTbsCertBytes)).map(String)
    console.log('[EIDBasedQueryIdentityCircuit] dg1 length:', dg1.length)

    // === DEBUG: Compute dg1_commitment in TypeScript and compare with stored value ===
    const dg1Bytes = new Uint8Array(dg1.map(Number))
    const skIdentity = params?.skIdentity ? BigInt(params.skIdentity) : BigInt(0)
    console.log(
      '[EIDBasedQueryIdentityCircuit] Using sk_identity for commitment check:',
      skIdentity.toString(10),
    )

    const computedDg1Commitment = computeDg1Commitment(dg1Bytes, skIdentity)
    console.log('[EIDBasedQueryIdentityCircuit] === DG1 COMMITMENT COMPARISON ===')
    console.log('  Stored (from registration): ', currentIdentity.dg1Commitment)
    console.log('  Computed (TypeScript):      ', computedDg1Commitment)
    console.log(
      '  Match:',
      currentIdentity.dg1Commitment === computedDg1Commitment ? '✓ YES' : '✗ NO - MISMATCH!',
    )

    // === DEBUG: Verify SMT value computation ===
    const dg1CommitBigInt = BigInt('0x' + computedDg1Commitment)
    const identityCounter = BigInt(params?.identityCounter ?? '0')
    const timestamp = BigInt(params?.timestamp ?? '0')
    const computedSmtValue = poseidon.hash([dg1CommitBigInt, identityCounter, timestamp])
    const computedSmtValueHex = '0x' + computedSmtValue.toString(16).padStart(64, '0')
    console.log('[EIDBasedQueryIdentityCircuit] === SMT VALUE COMPARISON ===')
    console.log('  Stored SMT value:           ', passportRegistrationProof.value?.toString())
    console.log('  Computed SMT value:         ', computedSmtValueHex)
    console.log('  dg1_commit used:', '0x' + computedDg1Commitment)
    console.log('  identity_counter used:', identityCounter.toString())
    console.log('  timestamp used:', timestamp.toString())
    console.log(
      '  Match:',
      passportRegistrationProof.value?.toString().toLowerCase() ===
        computedSmtValueHex.toLowerCase()
        ? '✓ YES'
        : '✗ NO - MISMATCH!',
    )
    // === END DEBUG ===

    // Convert BigInt siblings from contract to strings for circuit input
    const siblingsAsStrings = passportRegistrationProof.siblings.map((s: bigint | string) =>
      typeof s === 'bigint' ? s.toString() : s.toString(),
    )

    // Debug: Check actual sibling values (not just first 3)
    const nonZeroSiblings = siblingsAsStrings.filter(s => BigInt(s) !== 0n)
    console.log('[EIDBasedQueryIdentityCircuit] === SIBLINGS DEBUG ===')
    console.log('  Total siblings:', siblingsAsStrings.length)
    console.log('  Non-zero siblings count:', nonZeroSiblings.length)
    console.log(
      '  First 5 siblings (hex):',
      siblingsAsStrings
        .slice(0, 5)
        .map(s => '0x' + BigInt(s).toString(16).padStart(64, '0').slice(0, 20) + '...'),
    )
    if (nonZeroSiblings.length > 0) {
      console.log(
        '  First non-zero sibling:',
        '0x' + BigInt(nonZeroSiblings[0]).toString(16).padStart(64, '0'),
      )
    }

    // === DEBUG: Citizenship mask for INID circuit ===
    const citizenshipMaskUsed = params?.citizenshipMask ?? DEFAULT_MASK_HEX
    console.log('[EIDBasedQueryIdentityCircuit] === CITIZENSHIP CHECK DEBUG ===')
    console.log('  Mask being used:', citizenshipMaskUsed)
    console.log('  Expected INID_MASKS.IRAN:', DEFAULT_MASK_HEX)
    console.log('  IR code (18770) at bit 101, mask should be: 0x20000000000000000000000000')
    // === END DEBUG ===

    const inputs = this._normalizeQueryProofParams({
      idStateRoot: passportRegistrationProof.root?.toString(),
      dg1,
      pkPassportHash: `0x${currentIdentity.passportHash}`,
      siblings: siblingsAsStrings,
      ...params,
    })
    console.log('[EIDBasedQueryIdentityCircuit] Normalized inputs:', JSON.stringify(inputs))

    console.log('[EIDBasedQueryIdentityCircuit] Calling circuitParams.prove()...')
    try {
      const proof = await this.circuitParams.prove(JSON.stringify(inputs), byteCode)
      console.log('[EIDBasedQueryIdentityCircuit] Proof generated successfully')
      if (!proof) {
        throw new Error(`Proof generation failed for circuit ${this.circuitParams.name}`)
      }
      return proof
    } catch (error) {
      console.error('[EIDBasedQueryIdentityCircuit] Proof generation error:', error)
      throw error
    }
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
    const abiCode = new AbiCoder()

    // Debug: Log citizenship values from both potential indices
    // INID-specific quirk: The INID DG1 format places citizenship at a different byte offset,
    // which the circuit reads from the "sex" position. So for INID cards:
    // - pub_signals[5] = 0 (what would be citizenship in standard TD1)
    // - pub_signals[6] = citizenship value (what would be sex in standard TD1)
    const citizenshipFromIndex5 = proof.pub_signals[5]
    const citizenshipFromIndex6 = proof.pub_signals[6]
    console.log(`[submitVote] pub_signals[5] (standard TD1 citizenship): ${citizenshipFromIndex5}`)
    console.log(`[submitVote] pub_signals[6] (INID actual citizenship): ${citizenshipFromIndex6}`)

    // For INID cards, the circuit outputs citizenship at index 6 (due to DG1 format differences)
    // Standard TD1 would have citizenship at index 5, but INID puts it where sex normally is
    const citizenshipIndex = BigInt('0x' + citizenshipFromIndex5) === 0n ? 6 : 5
    const citizenshipValue = proof.pub_signals[citizenshipIndex]
    console.log(
      `[submitVote] Using citizenship from index ${citizenshipIndex}: 0x${citizenshipValue}`,
    )

    const userDataEncoded = abiCode.encode(
      ['uint256', 'uint256[]', 'tuple(uint256,uint256,uint256,uint256)'],
      [
        proposalId,
        // votes mask
        votes.map(v => 1 << Number(v)),
        // INIDUserData: (nullifier, citizenship, identityCreationTimestamp, personalNumber)
        // INID circuit outputs citizenship at index 6 (not 5) due to DG1 format differences
        // personalNumber is signal[8]: pers_number * selector_bits[1] (non-zero when bit 16 set)
        [
          '0x' + proof.pub_signals[0],
          '0x' + citizenshipValue,
          '0x' + proof.pub_signals[15],
          '0x' + proof.pub_signals[8],
        ],
      ],
    )

    if (!this._passportRegistrationProof)
      throw new Error("Passport registration proof doesn't exist")

    // For INID, use executeINID which uses our 23-signal builder with TD3-style layout
    // This is different from executeTD1Noir which uses the upstream 24-signal builder
    // INID circuit outputs TD3-style signals (no documentType, currentDate at index 13)
    const callDataHex =
      EIDBasedQueryIdentityCircuit.noirIdVotingContract.contractInterface.encodeFunctionData(
        'executeINID',
        [
          this._passportRegistrationProof.root as string,
          '0x' + proof.pub_signals[13],
          userDataEncoded,
          '0x' + proof.proof,
        ],
      )

    await relayerVote(callDataHex, Config.NOIR_ID_VOTING_CONTRACT)
  }

  async getEventId(proposalId: string) {
    return await this.proposalContract.getProposalEventId(proposalId)
  }

  async getPassportInfo() {
    console.log('[getPassportInfo] Fetching passport info from StateKeeper...')
    console.log('[getPassportInfo] identityKey:', this.currentIdentity.identityKey)
    const [passportInfo_, identityInfo_] = await this.currentIdentity.getPassportInfo()
    console.log(
      '[getPassportInfo] passportInfo_:',
      JSON.stringify(
        {
          activeIdentity: passportInfo_.activeIdentity?.toString(),
          identityReissueCounter: passportInfo_.identityReissueCounter?.toString(),
        },
        null,
        2,
      ),
    )
    console.log(
      '[getPassportInfo] identityInfo_:',
      JSON.stringify(
        {
          activePublicKey: identityInfo_.activePassport?.toString(),
          issueTimestamp: identityInfo_.issueTimestamp?.toString(),
        },
        null,
        2,
      ),
    )
    const identityReissueCounter = passportInfo_.identityReissueCounter
    const issueTimestamp = identityInfo_.issueTimestamp
    console.log(
      '[getPassportInfo] Returning identityCounter:',
      identityReissueCounter.toString(),
      'timestamp:',
      issueTimestamp.toString(),
    )
    return { identityCounter: identityReissueCounter, timestamp: issueTimestamp }
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
      await EIDBasedQueryIdentityCircuit.registrationPoseidonSMTContract.contractInstance.ROOT_VALIDITY(),
    )

    // The timestampUpper is the proposal's requirement for when identity must have been created
    // Subtract ROOT_VALIDITY to account for SMT root propagation delay
    const timestampUpper = BigInt(whitelistData.identityCreationTimestampUpperBound) - ROOT_VALIDITY

    // If user has registered, verify they meet the proposal's requirements
    if (timestamp > 0n) {
      // Check if user registered before the deadline
      if (timestamp > timestampUpper) {
        throw new Error('Identity was registered after the voting deadline')
      }

      const identityCountUpper = BigInt(whitelistData.identityCounterUpperBound)
      if (identityCounter > identityCountUpper) {
        throw new Error('Identity registered more than allowed, after voting start')
      }

      return { timestampUpper, identityCountUpper }
    }

    // User hasn't registered yet
    return { timestampUpper, identityCountUpper: BigInt(MAX_UINT_32_HEX) }
  }

  getEventData(votes: number[]): string {
    // 2) ABI‑encode as an array of (uint256,uint256) structs
    const abiCoder = AbiCoder.defaultAbiCoder()
    const encoded = abiCoder.encode(['uint256[]'], [votes.map(v => 1 << v)])

    // 3) Take keccak256 hash
    const hashHex = keccak256(encoded)

    // 4) Cast to BigInt
    const hashBn = toBigInt(hashHex)

    // 5) Mask down to 248 bits: (1<<248) - 1
    const mask = (BigInt(1) << BigInt(248)) - BigInt(1)
    const truncated = hashBn & mask

    // 6) Zero‑pad up to 32 bytes (uint256) and return hex
    return zeroPadValue(toBeHex(truncated), 32)
  }

  getDg1(tbsByes: Uint8Array): Uint8Array {
    console.log('[getDg1] Input TBS length:', tbsByes.length)
    console.log(
      '[getDg1] TBS first 50 bytes (hex):',
      Array.from(tbsByes.slice(0, 50))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
    )

    const { country_name, validity, given_name, surname, common_name } = this._parseRawTbs(tbsByes)

    console.log('[getDg1] Parsed fields:')
    console.log(
      '  country_name:',
      Array.from(country_name)
        .map(b => String.fromCharCode(b))
        .join(''),
      '= bytes:',
      Array.from(country_name),
    )
    console.log(
      '  validity[0] (16 bytes):',
      Array.from(validity[0])
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
    )
    console.log(
      '  validity[0] as ASCII:',
      Array.from(validity[0].slice(0, 15))
        .map(b => String.fromCharCode(b))
        .join(''),
      ', len=',
      validity[0][15],
    )
    console.log(
      '  validity[1] (16 bytes):',
      Array.from(validity[1])
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
    )
    console.log(
      '  validity[1] as ASCII:',
      Array.from(validity[1].slice(0, 15))
        .map(b => String.fromCharCode(b))
        .join(''),
      ', len=',
      validity[1][15],
    )
    console.log(
      '  given_name (31 bytes):',
      Array.from(given_name.slice(0, 16))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
      '..., len=',
      given_name[30],
    )
    console.log(
      '  surname (31 bytes):',
      Array.from(surname.slice(0, 16))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
      '..., len=',
      surname[30],
    )
    console.log(
      '  common_name (31 bytes):',
      Array.from(common_name.slice(0, 16))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
      '..., len=',
      common_name[30],
    )

    const dg1 = new Uint8Array(108)

    dg1[0] = country_name[0]
    dg1[1] = country_name[1]

    for (let j = 0; j < 13; j++) {
      dg1[j + 2] = validity[0][j]
      dg1[j + 15] = validity[1][j]
    }

    for (let j = 0; j < 31; j++) {
      dg1[j + 28] = given_name[j]
      dg1[j + 59] = surname[j]
    }

    for (let j = 0; j < 18; j++) {
      dg1[j + 90] = common_name[j]
    }

    console.log('[getDg1] Final dg1 (108 bytes):')
    console.log(
      '  [0-1] country:',
      dg1[0],
      dg1[1],
      '=',
      String.fromCharCode(dg1[0]),
      String.fromCharCode(dg1[1]),
    )
    console.log(
      '  [2-14] validity[0] (13 bytes):',
      Array.from(dg1.slice(2, 15))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
    )
    console.log(
      '  [15-27] validity[1] (13 bytes):',
      Array.from(dg1.slice(15, 28))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
    )
    console.log(
      '  [28-58] given_name (31 bytes):',
      Array.from(dg1.slice(28, 48))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
      '...',
    )
    console.log(
      '  [59-89] surname (31 bytes):',
      Array.from(dg1.slice(59, 79))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
      '...',
    )
    console.log(
      '  [90-107] common_name (18 bytes):',
      Array.from(dg1.slice(90, 108))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '),
    )
    console.log('  Full dg1 as decimal array:', JSON.stringify(Array.from(dg1)))

    return dg1
  }

  private _parseRawTbs(tbsByes: Uint8Array) {
    let current_offset = 28
    current_offset += tbsByes[current_offset] + 1
    current_offset += tbsByes[current_offset + 1] + 2

    const validity_len = tbsByes[current_offset + 3]
    const validity: [Uint8Array, Uint8Array] = [new Uint8Array(16), new Uint8Array(16)]

    for (let i = 0; i < 16; i++) {
      if (i < validity_len) {
        validity[0][i] = tbsByes[current_offset + 4 + i]
        validity[1][i] = tbsByes[current_offset + 6 + validity_len + i]
      }
    }

    validity[0][15] = validity_len
    validity[1][15] = validity_len

    current_offset += tbsByes[current_offset + 1] + 2

    const country_name = new Uint8Array(2)
    country_name[0] = tbsByes[current_offset + 13]
    country_name[1] = tbsByes[current_offset + 14]

    current_offset += tbsByes[current_offset + 3] + 4
    current_offset += tbsByes[current_offset + 1] + 2
    current_offset += 7 + tbsByes[current_offset + 5]

    const given_name = new Uint8Array(31)
    const given_name_len = tbsByes[current_offset]
    for (let i = 0; i < 30; i++) {
      if (i < given_name_len) {
        given_name[i] = tbsByes[current_offset + 1 + i]
      }
    }

    given_name[30] = given_name_len
    current_offset += given_name_len + 1

    current_offset += 7 + tbsByes[current_offset + 5]

    const surname = new Uint8Array(31)
    const surname_len = tbsByes[current_offset]
    for (let i = 0; i < 30; i++) {
      if (i < surname_len) {
        surname[i] = tbsByes[current_offset + 1 + i]
      }
    }
    surname[30] = surname_len
    current_offset += surname_len + 1

    current_offset += 7 + tbsByes[current_offset + 5]

    const common_name = new Uint8Array(31)
    const common_name_len = tbsByes[current_offset]
    for (let i = 0; i < 30; i++) {
      if (i < common_name_len) {
        common_name[i] = tbsByes[current_offset + 1 + i]
      }
    }
    common_name[30] = common_name_len

    return {
      country_name,
      validity,
      given_name,
      surname,
      common_name,
    }
  }

  /**
   * Constructs circuit inputs in the correct format for the current platform.
   */
  private _normalizeQueryProofParams(params: QueryProofParams = {}) {
    const useHex = Platform.OS === 'android'
    const toHex = (v: string) => this._ensureHexPrefix(BigInt(v).toString(16))
    const toDec = (v: string) => BigInt(v).toString(10)
    const fmt = (v: string | undefined, def: string) => (useHex ? toHex(v ?? def) : toDec(v ?? def))

    const formatArray = (arr: string[] = []) =>
      arr.map(item =>
        useHex ? this._ensureHexPrefix(BigInt(item).toString(16)) : BigInt(item).toString(10),
      )

    // INID circuit (queryIdentity_inid_ca) uses snake_case field names
    // These must match exactly with the circuit's ABI in byte_code.json:
    // event_id, event_data, id_state_root, selector, timestamp_lowerbound, timestamp_upperbound,
    // timestamp, identity_count_lowerbound, identity_count_upperbound, identity_counter,
    // birth_date_lowerbound, birth_date_upperbound, expiration_date_lowerbound, expiration_date_upperbound,
    // citizenship_mask, sk_identity, pk_passport_hash, dg1 (108 bytes), siblings (80 elements), current_date
    return {
      event_id: fmt(params.eventId, this._getRandomHex()),
      event_data: fmt(params.eventData, this._getRandomDecimal()),
      id_state_root: fmt(params.idStateRoot, '0'),
      selector: fmt(params.selector, '262143'),
      timestamp_lowerbound: fmt(params.timestampLower, '0'),
      timestamp_upperbound: fmt(params.timestampUpper, PRIME.toString()),
      timestamp: fmt(params.timestamp, '0'),
      identity_count_lowerbound: fmt(params.identityCountLower, '0'),
      identity_count_upperbound: fmt(params.identityCountUpper, PRIME.toString()),
      identity_counter: fmt(params.identityCounter, '0'),
      // Date bounds use 6-byte ASCII date format (ZERO_DATE_HEX = "000000", MAX_DATE_HEX = "999999")
      birth_date_lowerbound: fmt(params.birthDateLower, ZERO_DATE_HEX),
      birth_date_upperbound: fmt(params.birthDateUpper, MAX_DATE_HEX),
      expiration_date_lowerbound: fmt(params.expirationDateLower, ZERO_DATE_HEX),
      expiration_date_upperbound: fmt(params.expirationDateUpper, MAX_DATE_HEX),
      citizenship_mask: fmt(params.citizenshipMask, DEFAULT_MASK_HEX),
      sk_identity: fmt(params.skIdentity, '0'),
      pk_passport_hash: fmt(params.pkPassportHash, '0'),
      dg1: formatArray(params.dg1),
      siblings: formatArray(params.siblings),
      current_date: fmt(params.currentDate, ZERO_DATE_HEX),
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
