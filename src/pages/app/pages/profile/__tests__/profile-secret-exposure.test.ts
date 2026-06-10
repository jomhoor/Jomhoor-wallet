/// <reference types="jest" />

import fs from 'fs'
import path from 'path'

const profileSource = fs.readFileSync(path.join(__dirname, '..', 'index.tsx'), 'utf8')

describe('ProfileScreen wallet secret policy', () => {
  it('does not read, render, pass, or copy raw wallet secrets', () => {
    expect(profileSource).not.toMatch(/state\s*=>\s*state\.(privateKey|seed|mnemonic|secretKey)/)
    expect(profileSource).not.toContain('useCopyToClipboard')
    expect(profileSource).not.toMatch(/\bprivateKey\s*[:=}]/)
    expect(profileSource).not.toMatch(/\b(seed|mnemonic|secretKey)\s*[:=}]/)
  })

  it('renders only non-sensitive wallet status and recovery guidance', () => {
    expect(profileSource).toContain("t('profile.wallet-key-status')")
    expect(profileSource).toContain("t('profile.public-wallet-address')")
    expect(profileSource).toContain("t('profile.private-key-protected')")
    expect(profileSource).toContain("t('profile.recovery-guidance')")
    expect(profileSource).toContain('selectable={false}')
  })

  it('does not attach recovery errors to logs', () => {
    expect(profileSource).toContain("console.error('[Profile] SSO recovery failed')")
    expect(profileSource).not.toMatch(/console\.error\([^)]*,\s*(err|error)/)
  })
})
