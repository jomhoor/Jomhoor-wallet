const fs = require('fs')
const path = require('path')

const moduleRoot = path.resolve(__dirname, '..', '..')
const repoRoot = path.resolve(moduleRoot, '..', '..')
const sourcePath = path.join(
  repoRoot,
  'node_modules',
  '@iden3',
  'js-crypto',
  'src',
  'poseidon',
  'poseidon-constants-opt.json',
)
const outputPath = path.join(moduleRoot, 'native-core', 'src', 'poseidon-constants.json')

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))

const decode = value => {
  if (Array.isArray(value)) return value.map(decode)
  const bytes = Buffer.from(value, 'base64')
  return BigInt(`0x${bytes.toString('hex')}`).toString(10)
}

const generated = {}
for (const width of [2, 3, 4, 6]) {
  const index = width - 2
  generated[String(width)] = {
    C: decode(source.C[index]),
    S: decode(source.S[index]),
    M: decode(source.M[index]),
    P: decode(source.P[index]),
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(generated)}\n`)
