/// <reference types="jest" />

import fs from 'fs'
import path from 'path'

const moduleRoot = path.join(__dirname, '..')
const read = (relativePath: string) =>
  fs.readFileSync(path.join(moduleRoot, relativePath), 'utf8')

const publicApi = read('index.ts')
const nativeSources = [
  read('ios/src/WalletKeyServiceModule.swift'),
  read('android/src/main/java/expo/modules/walletkeyservice/WalletKeyServiceModule.kt'),
].join('\n')

describe('WalletKeyService secret boundary', () => {
  it('does not expose a raw-key read, import, or export API to JavaScript', () => {
    expect(publicApi).not.toMatch(
      /\b(getPrivateKey|getSecretKey|getSeed|getMnemonic|exportKey|importKey)\b/,
    )
    expect(publicApi).not.toMatch(/\b(privateKey|secretKey|seed|mnemonic)\s*:/)
  })

  it('exposes only fixed native operations that return public material or results', () => {
    expect(publicApi).toContain('getPublicMaterial')
    expect(publicApi).toContain('signChallenge')
    expect(publicApi).toContain('deriveNullifier')
    expect(nativeSources).not.toMatch(
      /(?:AsyncFunction|Function)\(["'](?:getPrivateKey|exportKey|importKey)/,
    )
  })

  it('does not log or send wallet key material from the module', () => {
    expect(nativeSources).not.toMatch(
      /\b(console\.|NSLog|print\(|Log\.[vdiew]\(|analytics|crashlytics)/i,
    )
  })
})
