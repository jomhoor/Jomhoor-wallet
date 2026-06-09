// Generate a fresh signature vector using the wallet's exact signing scheme
// so we can hand it to Go's VerifyWalletSignature and compare.
const { babyJub, eddsa, ffUtils, Hex, poseidon, PublicKey, Signature } = require('@iden3/js-crypto')
const { Buffer } = require('buffer')

const BN254_FP = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
)

// Deterministic sk for repeatable vectors.
const skHex = '0a' + '11'.repeat(31) // 32 bytes
const skBuff = Hex.decodeString(skHex)
const sk = ffUtils.beBuff2int(skBuff)
const point = babyJub.mulPointEScalar(babyJub.Base8, sk)
const pk = new PublicKey(point)
const [pkX, pkY] = pk.p

const addrHash = poseidon.hash([pkX, pkY])
const walletAddress = '0x' + Buffer.from(ffUtils.beInt2Buff(addrHash, 32)).toString('hex')

// Fixed challenge.
const challengeHex = '0x' + 'ab'.repeat(32)
const nonceBytes = Buffer.from(challengeHex.slice(2), 'hex')
const nonceBig = ffUtils.beBuff2int(Buffer.from(nonceBytes))
const msg = nonceBig % BN254_FP

const subOrder = babyJub.subOrder
const r = poseidon.hash([sk, msg]) % subOrder
const R8 = babyJub.mulPointEScalar(babyJub.Base8, r)
const hm = poseidon.hash([R8[0], R8[1], pkX, pkY, msg])
const S = (r + ((8n * hm * sk) % subOrder)) % subOrder

const packed = eddsa.packSignature(new Signature(R8, S))
const sigHex = '0x' + Buffer.from(packed).toString('hex')

console.log(
  JSON.stringify(
    {
      xHex: '0x' + pkX.toString(16).padStart(64, '0'),
      yHex: '0x' + pkY.toString(16).padStart(64, '0'),
      walletAddress,
      challenge: challengeHex,
      sig: sigHex,
    },
    null,
    2,
  ),
)
