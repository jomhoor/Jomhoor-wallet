export const PRIME = '21888242871839275222246405745257275088548364400416034343698204186575808495617'

export const MAX_UINT_32_HEX = '0xFFFFFFFF'
export const DEFAULT_MASK_HEX = '0x20000000000000000000000000' // Iran mask
export const ZERO_DATE_HEX = '0x303030303030' // "000000" in ASCII - minimum date (as integer: 52983525093424)
export const MAX_DATE_HEX = '0x393939393939' // "999999" in ASCII - maximum date for upper bounds (as integer: 63342393552185)

// MAX_FIELD_VALUE is PRIME-1, but this should NOT be used for date bounds!
// Date bounds should use ZERO_DATE_HEX (lower) and MAX_DATE_HEX (upper)
// because the circuit interprets dates as 6-byte big-endian integers.
export const MAX_FIELD_VALUE = (BigInt(PRIME) - 1n).toString()

// Proper date bounds as decimal strings (for use in circuit inputs)
// "000000" as 6-byte big-endian = 52983525093424
// "999999" as 6-byte big-endian = 63342393552185
export const MIN_DATE_DECIMAL = '52983525093424' // 0x303030303030
export const MAX_DATE_DECIMAL = '63342393552185' // 0x393939393939
