import { default as NoirModule } from './src/NoirModule'
import * as FileSystem from 'expo-file-system'

import { Config } from '@/config'

// Base URL of the self-hosted platform gateway that serves ZK circuit
// artifacts not published to Rarimo's public bucket (e.g. Iranian Passport
// Variant B, Type 9 / RSA-3072 / E33259). Trailing slashes are trimmed so the
// circuit path can be appended cleanly.
const SELF_HOSTED_CIRCUITS_BASE_URL = `${Config.RELAYER_API_URL.replace(/\/+$/, '')}/assets/circuits/passport-zk-circuits-noir`

export type NoirZKProof = {
  proof: string
  pub_signals: string[]
}

export class NoirCircuitParams {
  public static readonly TrustedSetupFileName = `${FileSystem.documentDirectory}/noir/ultraPlonkTrustedSetup.dat`

  constructor(
    public name: string,
    public byteCodeUri: string,
    public pub_signals_count: number,
  ) {}

  static fromName(circuitName: string): NoirCircuitParams {
    const found = supportedNoirCircuits.find(el => el.name === circuitName)

    if (!found) {
      throw new Error(`Noir Circuit with name ${circuitName} not found`)
    }

    return found
  }

  static async getTrustedSetupUri() {
    const fileInfo = await FileSystem.getInfoAsync(NoirCircuitParams.TrustedSetupFileName)

    if (!fileInfo.exists) {
      return null
    }

    return fileInfo.uri
  }

  static async downloadTrustedSetup(opts?: {
    onDownloadingProgress?: (p: FileSystem.DownloadProgressData) => void
  }) {
    const dir = `${FileSystem.documentDirectory}noir`

    // Ensure that the folder exists
    const dirInfo = await FileSystem.getInfoAsync(dir)
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
    }

    // Preparing path
    const fileUri = `${dir}/ultraPlonkTrustedSetup.dat`
    const url =
      'https://storage.googleapis.com/rarimo-store/trusted-setups/ultraPlonkTrustedSetup.dat'

    // Continue downloading
    const downloadResumable = FileSystem.createDownloadResumable(url, fileUri, {}, progress => {
      // DEBUG DOWNLOADING
      // console.log(
      //   `Progress: ${((progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100).toFixed(1)}%`,
      // )
      opts?.onDownloadingProgress?.(progress)
    })

    if (!(await NoirCircuitParams.getTrustedSetupUri())) {
      await downloadResumable.downloadAsync()
    }

    const uri = await NoirCircuitParams.getTrustedSetupUri()

    if (!uri) {
      throw new Error('Failed to download trusted setup')
    }

    return uri
  }

  static async getByteCodeUri(filename: string) {
    const fileInfo = await FileSystem.getInfoAsync(filename)

    if (!fileInfo.exists) {
      return null
    }

    return fileInfo.uri
  }

  // Validates that a cached/downloaded payload is a real Noir circuit manifest
  // and not, e.g., an nginx 404 HTML error page that was cached before the
  // artifact was hosted. The native Swoir loader needs `bytecode` + `abi`.
  private static isValidCircuitJson(content: string): boolean {
    if (!content) return false
    try {
      const parsed = JSON.parse(content)
      return typeof parsed?.bytecode === 'string' && parsed?.abi != null
    } catch {
      return false
    }
  }

  async downloadByteCode(opts?: {
    onDownloadingProgress?: (downloadProgress: FileSystem.DownloadProgressData) => void
  }): Promise<string> {
    const fileName = `${FileSystem.documentDirectory}/noir/${this.name}-bytecode.json`
    const downloadResumable = FileSystem.createDownloadResumable(
      this.byteCodeUri,
      fileName,
      {},
      downloadProgress => {
        opts?.onDownloadingProgress?.(downloadProgress)
      },
    )

    // Evict a stale cache. A previous fetch that failed (e.g. 404 HTML before
    // the circuit was hosted) is still written to disk by downloadAsync; if it
    // isn't valid circuit JSON, drop it so we re-download the real artifact.
    const cachedUri = await NoirCircuitParams.getByteCodeUri(fileName)
    if (cachedUri) {
      const cached = await FileSystem.readAsStringAsync(cachedUri)
      const valid = NoirCircuitParams.isValidCircuitJson(cached)
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log(
          `[NoirCircuit] cache present for ${this.name}: len=${cached?.length ?? 0} valid=${valid}`,
        )
      }
      if (!valid) {
        await FileSystem.deleteAsync(cachedUri, { idempotent: true })
        // eslint-disable-next-line no-console
        if (__DEV__) console.log(`[NoirCircuit] evicted invalid cache for ${this.name}`)
      }
    } else {
      // eslint-disable-next-line no-console
      if (__DEV__) console.log(`[NoirCircuit] no cache for ${this.name}`)
    }

    if (!(await NoirCircuitParams.getByteCodeUri(fileName))) {
      // eslint-disable-next-line no-console
      if (__DEV__) console.log(`[NoirCircuit] downloading ${this.name} from ${this.byteCodeUri}`)
      const result = await downloadResumable.downloadAsync()
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log(`[NoirCircuit] download ${this.name} status=${result?.status ?? 'unknown'}`)
      }

      if (!result || result.status !== 200) {
        // Don't leave a non-200 body cached for the next run.
        await FileSystem.deleteAsync(fileName, { idempotent: true })
        throw new Error(
          `Failed to download bytecode for noir circuit ${this.name}: HTTP ${result?.status ?? 'unknown'}`,
        )
      }
    }

    const uri = await NoirCircuitParams.getByteCodeUri(fileName)

    if (!uri) {
      throw new Error(`Failed to download bytecode for noir circuit ${this.name}`)
    }

    const byteCode = await FileSystem.readAsStringAsync(uri)

    if (!byteCode) {
      throw new Error(`Failed to read bytecode for noir circuit ${this.name}`)
    }

    if (!NoirCircuitParams.isValidCircuitJson(byteCode)) {
      // Corrupt/incomplete download — evict so a retry can recover.
      await FileSystem.deleteAsync(uri, { idempotent: true })
      throw new Error(
        `Downloaded bytecode for noir circuit ${this.name} is not a valid circuit manifest`,
      )
    }

    return byteCode
  }

  async prove(
    inputs: string,
    byteCodeString: string,
    proofType: 'plonk' | 'honk_keccak' = 'plonk',
  ): Promise<NoirZKProof> {
    const trustedSetupUri = await NoirCircuitParams.getTrustedSetupUri()

    if (!trustedSetupUri) {
      throw new Error('Trusted setup not found. Please download it first.')
    }

    const proof: string =
      proofType === 'honk_keccak'
        ? await NoirModule.proveUltraHonkKeccak(trustedSetupUri, inputs, byteCodeString)
        : await NoirModule.provePlonk(trustedSetupUri, inputs, byteCodeString)

    if (!proof) {
      throw new Error(`Failed to generate proof for noir circuit ${this.name}`)
    }

    if (proofType === 'honk_keccak') {
      return this.parseHonkKeccakProof(proof)
    }

    const pubSignalDataLength = 64 // hex

    const pubSignals: string[] = []
    for (let i = 0; i < this.pub_signals_count; i++) {
      const start = i * pubSignalDataLength
      const end = start + pubSignalDataLength
      pubSignals.push(proof.substring(start, end))
    }

    const actualProof = proof.substring(pubSignalDataLength * this.pub_signals_count)

    return {
      pub_signals: pubSignals,
      proof: actualProof,
    }
  }

  // The barretenberg keccak UltraHonk proof is serialized as a 4-byte big-endian
  // field count followed by 32-byte fields:
  //   [count:4][circuitSize][publicInputsSize][publicInputsOffset]
  //   [publicInput_0 .. publicInput_{k-1}][verifierProof...][tail...]
  // Public inputs are passed separately to Solidity verifiers, so we always
  // splice them into `pub_signals`. The native iOS/Android Honk prover is built
  // from Barretenberg v0.67, whose generated verifier reads metadata from the
  // proof body, so the proof passed on-chain is metadata + commitments.
  private parseHonkKeccakProof(proofHex: string): NoirZKProof {
    const FIELD = 64 // hex chars per 32-byte field
    const hex = proofHex.startsWith('0x') ? proofHex.slice(2) : proofHex

    // bb prepends a 4-byte (8 hex) big-endian field count. When present the
    // total hex length is 8 (mod 64); without it it would be 0 (mod 64).
    const prefixLen = hex.length % FIELD === 8 ? 8 : 0
    const metaLen = 3 * FIELD // circuitSize, publicInputsSize, publicInputsOffset

    const count = this.pub_signals_count
    const pubStart = prefixLen + metaLen
    const pubEnd = pubStart + count * FIELD

    const metaHex = hex.slice(prefixLen, pubStart)
    const commitHex = hex.slice(pubEnd)
    const metaWords = metaHex.match(new RegExp(`.{${FIELD}}`, 'g')) ?? []

    const pubSignals: string[] = []
    for (let i = 0; i < count; i++) {
      pubSignals.push(hex.slice(pubStart + i * FIELD, pubStart + (i + 1) * FIELD))
    }

    if (this.name === 'registerIdentity_9_160_3_3_336_216_1_1080_3_256') {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[NoirCircuit] type9 honk parse', {
          prefixBytes: prefixLen / 2,
          metaWords: metaWords.map(word => `0x${word}`),
          pubSignalsCount: pubSignals.length,
          pubSignal0: pubSignals[0] ? `0x${pubSignals[0]}` : null,
          commitFields: commitHex.length / FIELD,
          proofFields: (metaHex.length + commitHex.length) / FIELD,
        })
      }
    }

    return {
      pub_signals: pubSignals,
      proof: metaHex + commitHex,
    }
  }
}

export class NoirLocalCircuitParams extends NoirCircuitParams {
  constructor(
    public name: string,
    public getByteCodeFn: () => string,
    public pub_signals_count: number,
  ) {
    super(name, '', pub_signals_count)
  }

  async downloadByteCode() {
    const byteCode = this.getByteCodeFn()

    return typeof byteCode === 'string' ? byteCode : JSON.stringify(byteCode)
  }
}

const supportedNoirCircuits: NoirCircuitParams[] = [
  new NoirCircuitParams('queryIdentity', `${SELF_HOSTED_CIRCUITS_BASE_URL}/queryIdentity.json`, 23),
  new NoirLocalCircuitParams(
    'queryIdentity_inid_ca',
    () => require('@assets/circuits/noir/query-identity/inid/byte_code.json'),
    23,
  ),
  new NoirLocalCircuitParams(
    'registerIdentity_inid_ca',
    () => require('@assets/circuits/noir/register/inid/byte_code.json'),
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_26_512_3_3_336_248_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.15/registerIdentity_26_512_3_3_336_248_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_2_256_3_6_336_264_21_2448_6_2008',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.3/registerIdentity_2_256_3_6_336_264_21_2448_6_2008.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_2_256_3_6_336_248_1_2432_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.3/registerIdentity_2_256_3_6_336_248_1_2432_3_256.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_20_256_3_3_336_224_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.3/registerIdentity_20_256_3_3_336_224_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_10_256_3_3_576_248_1_1184_5_264',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v1.0.4/registerIdentity_10_256_3_3_576_248_1_1184_5_264.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_1_256_3_4_600_248_1_1496_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v1.0.4/registerIdentity_1_256_3_4_600_248_1_1496_3_256.json',
    5,
  ),
  // TODO: implement me
  new NoirCircuitParams('registerIdentity_21_256_3_3_336_232_NA', '', 5),
  new NoirCircuitParams(
    'registerIdentity_21_256_3_4_576_232_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.5-fix/registerIdentity_21_256_3_4_576_232_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_11_256_3_3_576_248_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.10-fix/registerIdentity_11_256_3_3_576_248_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_2_256_3_6_576_248_1_2432_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.6-fix/registerIdentity_2_256_3_6_576_248_1_2432_3_256.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_3_512_3_3_336_264_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.6-fix/registerIdentity_3_512_3_3_336_264_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_14_256_3_3_576_240_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.8-fix/registerIdentity_14_256_3_3_576_240_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_14_256_3_4_576_248_1_1496_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.8-fix/registerIdentity_14_256_3_4_576_248_1_1496_3_256.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_20_160_3_2_576_184_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.8-fix/registerIdentity_20_160_3_2_576_184_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_1_256_3_5_336_248_1_2120_4_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.7-fix/registerIdentity_1_256_3_5_336_248_1_2120_4_256.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_2_256_3_4_336_232_1_1480_4_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.7-fix/registerIdentity_2_256_3_4_336_232_1_1480_4_256.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_2_256_3_4_336_248_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.7-fix/registerIdentity_2_256_3_4_336_248_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_20_256_3_5_336_248_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.11-fix/registerIdentity_20_256_3_5_336_248_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_24_256_3_4_336_248_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.11-fix/registerIdentity_24_256_3_4_336_248_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_6_160_3_3_336_216_1_1080_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.11-fix/registerIdentity_6_160_3_3_336_216_1_1080_3_256.json',
    5,
  ),
  // Iranian Passport Variant B — RSA-3072 / exponent 33259 / SHA-1 (SIG_TYPE 9).
  // Not in Rarimo's public bucket; self-hosted by the platform gateway. Drop the
  // compiled bytecode JSON at platform/circuits/passport-zk-circuits-noir/ so it
  // is served at <RELAYER_API_URL>/assets/circuits/passport-zk-circuits-noir/.
  new NoirCircuitParams(
    'registerIdentity_9_160_3_3_336_216_1_1080_3_256',
    `${SELF_HOSTED_CIRCUITS_BASE_URL}/registerIdentity_9_160_3_3_336_216_1_1080_3_256.json`,
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_11_256_3_5_576_248_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.12-fix/registerIdentity_11_256_3_5_576_248_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_14_256_3_4_336_232_1_1480_5_296',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.12-fix/registerIdentity_14_256_3_4_336_232_1_1480_5_296.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_1_256_3_4_576_232_1_1480_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.12-fix/registerIdentity_1_256_3_4_576_232_1_1480_3_256.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_1_256_3_5_576_248_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.9-fix/registerIdentity_1_256_3_5_576_248_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_20_160_3_3_576_200_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.9-fix/registerIdentity_20_160_3_3_576_200_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_23_160_3_3_576_200_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.10-fix/registerIdentity_23_160_3_3_576_200_NA.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_3_256_3_4_600_248_1_1496_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.10-fix/registerIdentity_3_256_3_4_600_248_1_1496_3_256.json',
    5,
  ),
  new NoirCircuitParams(
    'registerIdentity_1_256_3_6_576_264_1_2448_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/v0.1.9-fix/registerIdentity_1_256_3_6_576_264_1_2448_3_256.json',
    5,
  ),
]
