import { resolveNidNfcProbeEnabled } from '../probe'

describe('resolveNidNfcProbeEnabled', () => {
  it('enables the probe only for development builds with the explicit flag', () => {
    expect(resolveNidNfcProbeEnabled(true, 'enabled')).toBe(true)
  })

  it.each([
    [false, 'enabled'],
    [true, undefined],
    [true, 'disabled'],
  ])('rejects isDev=%s flag=%s', (isDev, flag) => {
    expect(resolveNidNfcProbeEnabled(isDev as boolean, flag as string | undefined)).toBe(false)
  })
})
