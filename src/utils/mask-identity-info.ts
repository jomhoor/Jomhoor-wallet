/**
 * Mask identity information fields (NIDN, document numbers, etc.)
 * Pattern: first 2 characters + 3 asterisks + last character
 * Example: 1234567890 → 12***0
 */
export function maskIdentityInfo(value?: string | null): string {
  if (!value) return '—'

  const compact = String(value).replace(/\s+/g, '')

  if (compact.length === 0) return '—'
  if (compact.length === 1) return `${compact}***`
  if (compact.length === 2) return `${compact}***`

  const first2 = compact.slice(0, 2)
  const last1 = compact.slice(-1)
  return `${first2}***${last1}`
}
