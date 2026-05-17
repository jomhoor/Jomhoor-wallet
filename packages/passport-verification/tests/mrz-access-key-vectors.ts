import assert from 'node:assert/strict'
import passport from '../dist/passport'

// Mirrors Jomhoor's current passport-nfc-reader.ts behavior for MRZ key building.
function jomhoorMrzCheckDigit(s) {
  const weights = [7, 3, 1]
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i].toUpperCase()
    const val = c === '<' ? 0 : chars.indexOf(c)
    sum += val * weights[i % 3]
  }
  return String(sum % 10)
}

function jomhoorPadDate(d) {
  return String(d ?? '')
    .replace(/\D/g, '')
    .padStart(6, '0')
    .slice(0, 6)
}

function jomhoorBuildMrzKey(documentNumber, dateOfBirth, expiryDate) {
  const docNum = String(documentNumber ?? '')
    .toUpperCase()
    .padEnd(9, '<')
    .slice(0, 9)
  const dob = jomhoorPadDate(dateOfBirth)
  const expiry = jomhoorPadDate(expiryDate)

  const docCheck = jomhoorMrzCheckDigit(docNum)
  const dobCheck = jomhoorMrzCheckDigit(dob)
  const expiryCheck = jomhoorMrzCheckDigit(expiry)

  return `${docNum}${docCheck}${dob}${dobCheck}${expiry}${expiryCheck}`
}

const credentialVectors = [
  {
    input: { documentNumber: 'L898902C3', dateOfBirth: '740812', dateOfExpiry: '120415' },
  },
  {
    input: { documentNumber: 'AB12345', dateOfBirth: '90-01-09', dateOfExpiry: '300101' },
  },
  {
    input: { documentNumber: 'k1234567', dateOfBirth: '690806', dateOfExpiry: '940623' },
  },
]

for (const vector of credentialVectors) {
  const pkgKey = passport.buildPassportAccessKey(vector.input)
  const jomhoorKey = jomhoorBuildMrzKey(
    vector.input.documentNumber,
    vector.input.dateOfBirth,
    vector.input.dateOfExpiry,
  )
  assert.equal(pkgKey, jomhoorKey, `MRZ key mismatch for ${JSON.stringify(vector.input)}`)
}

const mrzText = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
]

const parsed = passport.parseMrz(mrzText)
assert.ok(parsed, 'Expected parseMrz to return a parsed object')
assert.equal(parsed.documentNumber, 'L898902C3')
assert.equal(parsed.dateOfBirth, '740812')
assert.equal(parsed.dateOfExpiry, '120415')

const fromMrz = passport.createPassportCredentialsFromMrz(mrzText)
const expectedFromJomhoor = jomhoorBuildMrzKey('L898902C3', '740812', '120415')
assert.equal(fromMrz.mrzKey, expectedFromJomhoor)

process.stdout.write('MRZ/access-key vectors passed\n')
