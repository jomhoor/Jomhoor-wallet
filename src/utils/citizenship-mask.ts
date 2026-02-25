/**
 * Citizenship Mask Utility
 *
 * Computes the citizenship mask for ZK voting proofs based on allowed nationalities.
 * The circuit uses a 240-country bitmask where each country has a specific position.
 * Country codes are 3-letter ISO 3166-1 alpha-3 codes encoded as UTF-8 integers.
 * For example: "IRN" → 0x49524E → 4805198
 *
 * The mask is a BigInt where bit position = countryIndex (for Noir circuits).
 * Noir uses bitmask.to_le_bits::<240>() then bitmask_bits[i] directly.
 * For example, Iran at index 103 has bit 103 set.
 *
 * NOTE: Circom circuits use num2bits.out[COUNTRY_COUNT - 1 - i] (big-endian style),
 * but our app uses Noir circuits which use little-endian bit ordering.
 *
 * @see https://github.com/rarimo/passport-zk-circuits-noir/blob/main/crates/citizenship_check/src/lib.nr
 */

/**
 * All 240 countries supported by the circuit, in order.
 * Each entry is the UTF-8 encoded value of the 3-letter country code.
 * Index in this array determines the bit position in the mask.
 */
const COUNTRY_CODES: readonly number[] = [
  4276823, // ABW (Aruba)
  4277831, // AFG (Afghanistan)
  4278095, // AGO (Angola)
  4278593, // AIA (Anguilla)
  4279362, // ALB (Albania)
  4279876, // AND (Andorra)
  4279892, // ANT (Netherlands Antilles)
  4280901, // ARE (United Arab Emirates)
  4280903, // ARG (Argentina)
  4280909, // ARM (Armenia)
  4281165, // ASM (American Samoa)
  4281409, // ATA (Antarctica)
  4281415, // ATG (Antigua and Barbuda)
  4281683, // AUS (Australia)
  4281684, // AUT (Austria)
  4282949, // AZE (Azerbaijan)
  4342857, // BDI (Burundi)
  4343116, // BEL (Belgium)
  4343118, // BEN (Benin)
  4343361, // BFA (Burkina Faso)
  4343620, // BGD (Bangladesh)
  4343634, // BGR (Bulgaria)
  4343890, // BHR (Bahrain)
  4343891, // BHS (Bahamas)
  4344136, // BIH (Bosnia and Herzegovina)
  4344909, // BLM (Saint Barthélemy)
  4344914, // BLR (Belarus)
  4344922, // BLZ (Belize)
  4345173, // BMU (Bermuda)
  4345676, // BOL (Bolivia)
  4346433, // BRA (Brazil)
  4346434, // BRB (Barbados)
  4346446, // BRN (Brunei)
  4346958, // BTN (Bhutan)
  4347713, // BWA (Botswana)
  4407622, // CAF (Central African Republic)
  4407630, // CAN (Canada)
  4408139, // CCK (Cocos Islands)
  4409413, // CHE (Switzerland)
  4409420, // CHL (Chile)
  4409422, // CHN (China)
  4409686, // CIV (Côte d'Ivoire)
  4410706, // CMR (Cameroon)
  4411204, // COD (Democratic Republic of the Congo)
  4411207, // COG (Congo)
  4411211, // COK (Cook Islands)
  4411212, // COL (Colombia)
  4411213, // COM (Comoros)
  4411478, // CPV (Cape Verde)
  4411977, // CRI (Costa Rica)
  4412738, // CUB (Cuba)
  4412759, // CUW (Curaçao)
  4413522, // CXR (Christmas Island)
  4413773, // CYM (Cayman Islands)
  4413776, // CYP (Cyprus)
  4414021, // CZE (Czech Republic)
  4474197, // DEU (Germany)
  4475465, // DJI (Djibouti)
  4476225, // DMA (Dominica)
  4476491, // DNK (Denmark)
  4476749, // DOM (Dominican Republic)
  4479553, // DZA (Algeria)
  4539221, // ECU (Ecuador)
  4540249, // EGY (Egypt)
  4543049, // ERI (Eritrea)
  4543304, // ESH (Western Sahara)
  4543312, // ESP (Spain)
  4543316, // EST (Estonia)
  4543560, // ETH (Ethiopia)
  4606286, // FIN (Finland)
  4606537, // FJI (Fiji)
  4607051, // FLK (Falkland Islands)
  4608577, // FRA (France)
  4608591, // FRO (Faroe Islands)
  4608845, // FSM (Micronesia)
  4669762, // GAB (Gabon)
  4670034, // GBR (United Kingdom)
  4670799, // GEO (Georgia)
  4671321, // GGY (Guernsey)
  4671553, // GHA (Ghana)
  4671810, // GIB (Gibraltar)
  4671822, // GIN (Guinea)
  4672834, // GMB (Gambia)
  4673090, // GNB (Guinea-Bissau)
  4673105, // GNQ (Equatorial Guinea)
  4674115, // GRC (Greece)
  4674116, // GRD (Grenada)
  4674124, // GRL (Greenland)
  4674637, // GTM (Guatemala)
  4674893, // GUM (Guam)
  4674905, // GUY (Guyana)
  4737863, // HKG (Hong Kong)
  4738628, // HND (Honduras)
  4739670, // HRV (Croatia)
  4740169, // HTI (Haiti)
  4740430, // HUN (Hungary)
  4801614, // IDN (Indonesia)
  4803918, // IMN (Isle of Man)
  4804164, // IND (India)
  4804436, // IOT (British Indian Ocean Territory)
  4805196, // IRL (Ireland)
  4805198, // IRN (Iran) ← Index 103
  4805201, // IRQ (Iraq)
  4805452, // ISL (Iceland)
  4805458, // ISR (Israel)
  4805697, // ITA (Italy)
  4866381, // JAM (Jamaica)
  4867417, // JEY (Jersey)
  4869970, // JOR (Jordan)
  4870222, // JPN (Japan)
  4931930, // KAZ (Kazakhstan)
  4932942, // KEN (Kenya)
  4933466, // KGZ (Kyrgyzstan)
  4933709, // KHM (Cambodia)
  4933970, // KIR (Kiribati)
  4935233, // KNA (Saint Kitts and Nevis)
  4935506, // KOR (South Korea)
  4937556, // KWT (Kuwait)
  4997455, // LAO (Laos)
  4997710, // LBN (Lebanon)
  4997714, // LBR (Liberia)
  4997721, // LBY (Libya)
  4997953, // LCA (Saint Lucia)
  4999493, // LIE (Liechtenstein)
  5000001, // LKA (Sri Lanka)
  5002063, // LSO (Lesotho)
  5002325, // LTU (Lithuania)
  5002584, // LUX (Luxembourg)
  5002817, // LVA (Latvia)
  5062979, // MAC (Macau)
  5062982, // MAF (Saint Martin)
  5062994, // MAR (Morocco)
  5063503, // MCO (Monaco)
  5063745, // MDA (Moldova)
  5063751, // MDG (Madagascar)
  5063766, // MDV (Maldives)
  5064024, // MEX (Mexico)
  5064780, // MHL (Marshall Islands)
  5065540, // MKD (North Macedonia)
  5065801, // MLI (Mali)
  5065812, // MLT (Malta)
  5066066, // MMR (Myanmar)
  5066309, // MNE (Montenegro)
  5066311, // MNG (Mongolia)
  5066320, // MNP (Northern Mariana Islands)
  5066586, // MOZ (Mozambique)
  5067348, // MRT (Mauritania)
  5067602, // MSR (Montserrat)
  5068115, // MUS (Mauritius)
  5068617, // MWI (Malawi)
  5069139, // MYS (Malaysia)
  5069140, // MYT (Mayotte)
  5128525, // NAM (Namibia)
  5129036, // NCL (New Caledonia)
  5129554, // NER (Niger)
  5130049, // NGA (Nigeria)
  5130563, // NIC (Nicaragua)
  5130581, // NIU (Niue)
  5131332, // NLD (Netherlands)
  5132114, // NOR (Norway)
  5132364, // NPL (Nepal)
  5132885, // NRU (Nauru)
  5134924, // NZL (New Zealand)
  5197134, // OMN (Oman)
  5259595, // PAK (Pakistan)
  5259598, // PAN (Panama)
  5260110, // PCN (Pitcairn Islands)
  5260626, // PER (Peru)
  5261388, // PHL (Philippines)
  5262423, // PLW (Palau)
  5262919, // PNG (Papua New Guinea)
  5263180, // POL (Poland)
  5263945, // PRI (Puerto Rico)
  5263947, // PRK (North Korea)
  5263956, // PRT (Portugal)
  5263961, // PRY (Paraguay)
  5264197, // PSE (Palestine)
  5265734, // PYF (French Polynesia)
  5325140, // QAT (Qatar)
  5391701, // REU (Réunion)
  5394261, // ROU (Romania)
  5395795, // RUS (Russia)
  5396289, // RWA (Rwanda)
  5456213, // SAU (Saudi Arabia)
  5456974, // SDN (Sudan)
  5457230, // SEN (Senegal)
  5457744, // SGP (Singapore)
  5457998, // SHN (Saint Helena)
  5458509, // SJM (Svalbard and Jan Mayen)
  5459010, // SLB (Solomon Islands)
  5459013, // SLE (Sierra Leone)
  5459030, // SLV (El Salvador)
  5459282, // SMR (San Marino)
  5459789, // SOM (Somalia)
  5460045, // SPM (Saint Pierre and Miquelon)
  5460546, // SRB (Serbia)
  5460804, // SSD (South Sudan)
  5461072, // STP (São Tomé and Príncipe)
  5461330, // SUR (Suriname)
  5461579, // SVK (Slovakia)
  5461582, // SVN (Slovenia)
  5461829, // SWE (Sweden)
  5461850, // SWZ (Eswatini)
  5462093, // SXM (Sint Maarten)
  5462339, // SYC (Seychelles)
  5462354, // SYR (Syria)
  5522241, // TCA (Turks and Caicos Islands)
  5522244, // TCD (Chad)
  5523279, // TGO (Togo)
  5523521, // THA (Thailand)
  5524043, // TJK (Tajikistan)
  5524300, // TKL (Tokelau)
  5524301, // TKM (Turkmenistan)
  5524563, // TLS (Timor-Leste)
  5525326, // TON (Tonga)
  5526607, // TTO (Trinidad and Tobago)
  5526862, // TUN (Tunisia)
  5526866, // TUR (Turkey)
  5526870, // TUV (Tuvalu)
  5527374, // TWN (Taiwan)
  5528129, // TZA (Tanzania)
  5588801, // UGA (Uganda)
  5589842, // UKR (Ukraine)
  5591641, // URY (Uruguay)
  5591873, // USA (United States)
  5593666, // UZB (Uzbekistan)
  5652820, // VAT (Vatican City)
  5653332, // VCT (Saint Vincent and the Grenadines)
  5653838, // VEN (Venezuela)
  5654338, // VGB (British Virgin Islands)
  5654866, // VIR (U.S. Virgin Islands)
  5656141, // VNM (Vietnam)
  5657940, // VUT (Vanuatu)
  5721158, // WLF (Wallis and Futuna)
  5722957, // WSM (Samoa)
  5786456, // XKX (Kosovo)
  5850445, // YEM (Yemen)
  5914950, // ZAF (South Africa)
  5918018, // ZMB (Zambia)
  5920581, // ZWE (Zimbabwe)
] as const

const COUNTRY_COUNT = 240

/**
 * Map from 3-letter country code to its index in COUNTRY_CODES array
 */
const COUNTRY_CODE_TO_INDEX: Map<string, number> = new Map()

// Build reverse mapping from ISO code string to index
COUNTRY_CODES.forEach((code, index) => {
  // Convert numeric code back to 3-letter string
  const char1 = String.fromCharCode((code >> 16) & 0xff)
  const char2 = String.fromCharCode((code >> 8) & 0xff)
  const char3 = String.fromCharCode(code & 0xff)
  const isoCode = char1 + char2 + char3
  COUNTRY_CODE_TO_INDEX.set(isoCode, index)
})

/**
 * Convert a 3-letter ISO country code to its UTF-8 encoded integer value
 * @example countryCodeToInt('IRN') → 4805198
 */
export function countryCodeToInt(code: string): number {
  if (code.length !== 3) {
    throw new Error(`Invalid country code: ${code}. Must be 3 characters.`)
  }
  const upper = code.toUpperCase()
  return (upper.charCodeAt(0) << 16) | (upper.charCodeAt(1) << 8) | upper.charCodeAt(2)
}

/**
 * Convert a UTF-8 encoded country integer back to 3-letter code
 * @example intToCountryCode(4805198) → 'IRN'
 */
export function intToCountryCode(code: number): string {
  const char1 = String.fromCharCode((code >> 16) & 0xff)
  const char2 = String.fromCharCode((code >> 8) & 0xff)
  const char3 = String.fromCharCode(code & 0xff)
  return char1 + char2 + char3
}

/**
 * Get the bit index for a country code in the citizenship mask
 * Returns undefined if the country is not in the supported list
 */
export function getCountryBitIndex(countryCode: string): number | undefined {
  return COUNTRY_CODE_TO_INDEX.get(countryCode.toUpperCase())
}

/**
 * Compute the citizenship mask for a list of allowed nationalities.
 *
 * The Noir circuit uses `bitmask.to_le_bits::<240>()` which means bit index `i`
 * in the mask directly corresponds to country index `i` in the COUNTRY_CODES array.
 *
 * For example, Iran at index 103: mask bit position = 103
 *
 * @param nationalities - Array of 3-letter ISO country codes (e.g., ['IRN', 'DEU'])
 * @returns Hex string representation of the mask
 *
 * @example
 * // Single country (Iran at index 103)
 * computeCitizenshipMask(['IRN']) // → '0x80...' with bit 103 set
 *
 * @example
 * // Multiple countries
 * computeCitizenshipMask(['IRN', 'USA']) // → mask with both bits set
 *
 * @example
 * // Empty array = all zeros (no countries allowed)
 * computeCitizenshipMask([]) // → '0x0'
 */
export function computeCitizenshipMask(nationalities: string[]): string {
  if (!nationalities || nationalities.length === 0) {
    return '0x0'
  }

  let mask = BigInt(0)

  for (const country of nationalities) {
    const index = getCountryBitIndex(country)
    if (index === undefined) {
      console.warn(`[CitizenshipMask] Unknown country code: ${country}, skipping`)
      continue
    }

    // Noir uses bitmask.to_le_bits::<240>() so bit position = index directly
    // For Iran at index 103, we set bit 103
    const bitPosition = index
    mask |= BigInt(1) << BigInt(bitPosition)
  }

  return '0x' + mask.toString(16)
}

/**
 * Check if a citizenship mask includes a specific country
 * @param mask - Hex string citizenship mask
 * @param countryCode - 3-letter ISO country code
 * @returns true if the country is included in the mask
 */
export function isCitizenshipAllowed(mask: string, countryCode: string): boolean {
  const index = getCountryBitIndex(countryCode)
  if (index === undefined) {
    return false
  }

  const maskBigInt = BigInt(mask)
  // Noir uses to_le_bits, so bit position = index directly
  const bitPosition = index
  const bit = (maskBigInt >> BigInt(bitPosition)) & BigInt(1)

  return bit === BigInt(1)
}

/**
 * Get list of all allowed countries from a citizenship mask
 * @param mask - Hex string citizenship mask
 * @returns Array of 3-letter ISO country codes that are allowed
 */
export function getAllowedCountries(mask: string): string[] {
  const maskBigInt = BigInt(mask)
  const allowed: string[] = []

  COUNTRY_CODES.forEach((code, index) => {
    // Noir uses to_le_bits, so bit position = index directly
    const bitPosition = index
    const bit = (maskBigInt >> BigInt(bitPosition)) & BigInt(1)
    if (bit === BigInt(1)) {
      allowed.push(intToCountryCode(code))
    }
  })

  return allowed
}

// Pre-computed masks for common use cases
export const MASKS = {
  /** Iran only - computed from index in COUNTRY_CODES array */
  IRAN: computeCitizenshipMask(['IRN']),
  /** No countries (empty mask) */
  NONE: '0x0',
  /** All countries (full mask) - use with caution, very large number */
  ALL: '0x' + ((BigInt(1) << BigInt(COUNTRY_COUNT)) - BigInt(1)).toString(16),
} as const

// Log the computed Iran mask for debugging (only in dev)
if (__DEV__) {
  console.log(`[CitizenshipMask] Iran mask computed as: ${MASKS.IRAN}`)
}

// ==============================================================================
// INID-SPECIFIC FUNCTIONS (238 2-letter country codes)
// ==============================================================================

/**
 * 2-letter country codes used by INID circuit (238 entries).
 * Each entry is: char1*256 + char2 (e.g., "IR" = 73*256 + 82 = 18770)
 *
 * @see byte_code.json in assets/circuits/noir/query-identity/inid/
 */
const INID_COUNTRY_CODES: readonly number[] = [
  16727, 16710, 16719, 16713, 16716, 16708, 16718, 16709, 16722, 16717, 16723, 16721, 16711, 16725,
  16724, 16730, 16969, 16965, 16970, 16966, 16964, 16967, 16968, 16979, 16961, 16972, 16985, 16986,
  16973, 16975, 16978, 16962, 16974, 16980, 16983, 17222, 17217, 17219, 17224, 17228, 17230, 17225,
  17229, 17220, 17223, 17227, 17231, 19277, 17238, 17234, 17237, 17239, 17240, 19289, 17241, 17242,
  17477, 17482, 17485, 17483, 17487, 17498, 17731, 17735, 17746, 17736, 17747, 17733, 17748, 17993,
  17994, 17995, 18002, 17999, 17997, 18241, 18242, 18245, 18247, 18248, 18249, 18254, 18253, 18263,
  18257, 18258, 18244, 18252, 18260, 18261, 18265, 18507, 18510, 18514, 18516, 18517, 18756, 18765,
  18766, 18767, 18757, 18770, 18769, 18771, 18764, 18772, 19021, 19013, 19023, 19024, 19290, 19269,
  19271, 19272, 19273, 19278, 19282, 19287, 19521, 19522, 19538, 19545, 19523, 19529, 19531, 19539,
  19540, 19541, 19791, 19782, 19777, 19779, 19780, 19783, 19798, 19800, 19784, 19787, 19788, 19796,
  19789, 19781, 19790, 19792, 19802, 19794, 19795, 19797, 19799, 19801, 22868, 20033, 20035, 20037,
  20039, 20041, 20053, 20044, 20047, 20048, 20050, 20058, 20301, 20555, 20545, 20558, 20549, 20552,
  20567, 20551, 20556, 20562, 19280, 20564, 20569, 20563, 20801, 21061, 21071, 21077, 21079, 21313,
  21316, 21326, 21319, 21320, 21322, 21314, 21324, 21334, 21325, 21327, 20557, 21075, 21331, 21332,
  21330, 21323, 21321, 21317, 21338, 21336, 21315, 21337, 21571, 21572, 21575, 21576, 21578, 21579,
  21581, 21580, 21583, 21588, 21582, 21586, 21590, 21591, 21594, 21831, 21825, 21849, 21843, 21850,
  22081, 22083, 22085, 22087, 22089, 22094, 22101, 22342, 22355, 22603, 22853, 23105, 23117, 23127,
] as const

const INID_COUNTRY_COUNT = 238

/**
 * Map from 2-letter country code to its index in INID_COUNTRY_CODES array
 */
const INID_CODE_TO_INDEX: Map<string, number> = new Map()

// Build reverse mapping from 2-letter ISO code string to index
INID_COUNTRY_CODES.forEach((code, index) => {
  const char1 = String.fromCharCode((code >> 8) & 0xff)
  const char2 = String.fromCharCode(code & 0xff)
  const isoCode = char1 + char2
  INID_CODE_TO_INDEX.set(isoCode, index)
})

/**
 * ISO 3166-1 alpha-3 to alpha-2 conversion for common countries.
 * Used to convert 3-letter codes from proposals to 2-letter codes for INID circuit.
 */
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  // Most commonly needed
  IRN: 'IR', // Iran
  DEU: 'DE', // Germany
  USA: 'US', // United States
  GBR: 'GB', // United Kingdom
  FRA: 'FR', // France
  ITA: 'IT', // Italy
  ESP: 'ES', // Spain
  NLD: 'NL', // Netherlands
  BEL: 'BE', // Belgium
  AUT: 'AT', // Austria
  CHE: 'CH', // Switzerland
  POL: 'PL', // Poland
  SWE: 'SE', // Sweden
  NOR: 'NO', // Norway
  DNK: 'DK', // Denmark
  FIN: 'FI', // Finland
  CAN: 'CA', // Canada
  AUS: 'AU', // Australia
  JPN: 'JP', // Japan
  CHN: 'CN', // China
  IND: 'IN', // India
  BRA: 'BR', // Brazil
  MEX: 'MX', // Mexico
  RUS: 'RU', // Russia
  TUR: 'TR', // Turkey
  SAU: 'SA', // Saudi Arabia
  ARE: 'AE', // United Arab Emirates
  AFG: 'AF', // Afghanistan
  IRQ: 'IQ', // Iraq
  ISR: 'IL', // Israel
  PAK: 'PK', // Pakistan
  EGY: 'EG', // Egypt
  UKR: 'UA', // Ukraine
}

/**
 * Convert 3-letter ISO code to 2-letter ISO code
 * Returns the original code if no mapping exists (might already be 2-letter)
 */
function alpha3ToAlpha2(code: string): string {
  const upper = code.toUpperCase()
  // If it's already 2 letters, return as-is
  if (upper.length === 2) {
    return upper
  }
  // Try to convert 3-letter to 2-letter
  const alpha2 = ALPHA3_TO_ALPHA2[upper]
  if (alpha2) {
    return alpha2
  }
  // Return original if no mapping (will be handled by caller)
  return upper
}

/**
 * Convert a 2-letter ISO country code to its UTF-8 encoded integer value
 * @example inidCountryCodeToInt('IR') → 18770
 */
export function inidCountryCodeToInt(code: string): number {
  if (code.length !== 2) {
    throw new Error(`Invalid INID country code: ${code}. Must be 2 characters.`)
  }
  const upper = code.toUpperCase()
  return (upper.charCodeAt(0) << 8) | upper.charCodeAt(1)
}

/**
 * Convert a UTF-8 encoded 2-letter country integer back to 2-letter code
 * @example inidIntToCountryCode(18770) → 'IR'
 */
export function inidIntToCountryCode(code: number): string {
  const char1 = String.fromCharCode((code >> 8) & 0xff)
  const char2 = String.fromCharCode(code & 0xff)
  return char1 + char2
}

/**
 * Get the bit index for a 2-letter country code in the INID citizenship mask
 * Returns undefined if the country is not in the supported list
 */
export function getInidCountryBitIndex(countryCode: string): number | undefined {
  return INID_CODE_TO_INDEX.get(countryCode.toUpperCase())
}

/**
 * Compute citizenship mask for INID using 2-letter country codes (238 entries).
 *
 * INID circuit uses bitmask.to_le_bits::<238>(), so bit position = index directly.
 * For "IR" at index 101, bit 101 should be set.
 *
 * NOTE: This function now accepts BOTH 2-letter AND 3-letter codes!
 * 3-letter codes (like 'IRN') are automatically converted to 2-letter (like 'IR').
 *
 * @param nationalities - Array of ISO country codes (2 or 3-letter, e.g., ['IR'], ['IRN'])
 * @returns Hex string representation of the mask
 *
 * @example
 * computeInidCitizenshipMask(['IR'])   // → '0x20000000000000000000000000' (bit 101 set)
 * computeInidCitizenshipMask(['IRN'])  // → '0x20000000000000000000000000' (same result)
 */
export function computeInidCitizenshipMask(nationalities: string[]): string {
  if (!nationalities || nationalities.length === 0) {
    return '0x0'
  }

  let mask = BigInt(0)

  for (const country of nationalities) {
    // Convert 3-letter to 2-letter if needed
    const alpha2 = alpha3ToAlpha2(country)
    const index = getInidCountryBitIndex(alpha2)

    if (index === undefined) {
      console.warn(
        `[InidCitizenshipMask] Unknown country code: ${country} (converted to: ${alpha2}), skipping`,
      )
      continue
    }

    console.log(`[InidCitizenshipMask] Country ${country} → ${alpha2} → bit index ${index}`)
    // INID circuit uses bitmask.to_le_bits::<238>() so bit position = index directly
    mask |= BigInt(1) << BigInt(index)
  }

  const result = '0x' + mask.toString(16)
  console.log(`[InidCitizenshipMask] Computed mask for ${nationalities.join(', ')}: ${result}`)
  return result
}

// Pre-computed masks for INID
export const INID_MASKS = {
  /** Iran only - "IR" at index 101 */
  IRAN: computeInidCitizenshipMask(['IR']),
  /** No countries (empty mask) */
  NONE: '0x0',
  /** All countries (full mask) */
  ALL: '0x' + ((BigInt(1) << BigInt(INID_COUNTRY_COUNT)) - BigInt(1)).toString(16),
} as const

// Log the computed INID Iran mask for debugging
if (__DEV__) {
  console.log(`[InidCitizenshipMask] Iran mask computed as: ${INID_MASKS.IRAN}`)
}
