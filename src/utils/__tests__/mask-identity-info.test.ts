import { maskIdentityInfo } from '../mask-identity-info'

describe('maskIdentityInfo', () => {
  it('should mask a standard 10-digit NIDN', () => {
    expect(maskIdentityInfo('1234567890')).toBe('12***0')
  })

  it('should mask a 5-digit number', () => {
    expect(maskIdentityInfo('12345')).toBe('12***5')
  })

  it('should mask a 3-digit number', () => {
    expect(maskIdentityInfo('123')).toBe('12***3')
  })

  it('should mask a 2-digit number', () => {
    expect(maskIdentityInfo('12')).toBe('12***')
  })

  it('should handle a single digit', () => {
    expect(maskIdentityInfo('1')).toBe('1***')
  })

  it('should handle whitespace and remove it', () => {
    expect(maskIdentityInfo('1234 5678 90')).toBe('12***0')
  })

  it('should handle undefined', () => {
    expect(maskIdentityInfo(undefined)).toBe('—')
  })

  it('should handle empty string', () => {
    expect(maskIdentityInfo('')).toBe('—')
  })

  it('should handle string with only whitespace', () => {
    expect(maskIdentityInfo('   ')).toBe('—')
  })

  it('should mask document numbers', () => {
    expect(maskIdentityInfo('AB1234CD')).toBe('AB***D')
  })

  it('should mask passport numbers', () => {
    expect(maskIdentityInfo('M12345678')).toBe('M1***8')
  })
})
