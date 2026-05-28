# NID Proof Generation: Data Gap Investigation & Implementation Plan

**Date**: May 28, 2026  
**Status**: Investigation Complete — Ready for Implementation  
**Scope**: Identify missing data for Noir proof generation in NID verification flow

---

## Executive Summary

**Problem**: Proof generation fails because the NID NFC flow only extracts certificate hex strings, not the complete data groups (DG1, DG15, SOD) required by the Noir circuit.

**Current State**:

- ✅ NFC reading works (certificates extracted)
- ✅ Proof circuit exists (NoirEIDBasedRegistrationCircuit ready)
- ✅ Rarimo integration ready
- ❌ **Data gap**: DG1, DG15, SOD bytes not exposed in verification flow

**Solution**: Extend NFC reading → expose DG bytes → create adapter → pass to proof generation

---

## Current Data Flow (Broken Path)

```
1. ScanNfcStep.tsx
   └─ readLiveNidNfc()
      └─ readSigningAndAuthCertificates()
         └─ inid-nfc-reader.ts (ONLY reads certs)
            └─ Returns: { signingCert, authCert } hex strings

2. NidNfcReadResult
   └─ status, nationalId, signingCertHex, authCertHex
   └─ ❌ MISSING: dg1Bytes, dg15Bytes, sodBytes

3. ScanProvider.createIdentity()
   └─ NoirEIDRegistration.createIdentity()
      └─ Expects: EID with sigCertificate + authCertificate (parsed ASN.1)
      └─ BUT NO: dg1Bytes, dg15Bytes, sodBytes

4. NoirEIDBasedRegistrationCircuit.prove()
   └─ Input circuit needs:
      ├─ tbs (to-be-signed bytes from cert)          ✅ Can derive from cert
      ├─ pk (public key chunks)                       ✅ Can derive from cert
      ├─ signature (signature chunks)                 ✅ Can derive from cert
      ├─ len (TBS length)                             ✅ Can derive from cert
      ├─ icao_root (from Rarimo SMT)                 ✅ Available
      ├─ inclusion_branches (from Rarimo SMT)        ✅ Available
      └─ sk_identity (wallet private key)            ✅ Available

   ❌ PROBLEM: Current EID struct only has certificates
      → Cannot access dg1, dg15, sodBytes needed for future extensions
      → Cannot validate that DG data matches certificate hashes
```

---

## Comparison: Passport Flow (Working) vs NID Flow (Broken)

### Passport (EPassport — ✅ WORKS)

**NFC Reading** → Data Exposed:

```typescript
// @iland/passport-verification returns PassportNfcReadResult with:
files: {
  DG1: {
    status: 'ok',
    data: { rawHex: '...', parsed: {...} }
  },
  DG15: {
    status: 'ok',
    data: { rawHex: '...', parsed: {...} }
  },
  SOD: {
    status: 'ok',
    data: { rawHex: '...', parsed: {...} }
  },
  ...
}
```

**Adapter** → EPassport Created:

```typescript
// packageNfcResultToEPassport() in document-scan/adapters/
export function packageNfcResultToEPassport(result: PassportNfcReadResult): EPassport {
  const dg1RawHex = readRawHex(result, 'DG1')  // ✅ Extracted
  const sodRawHex = readRawHex(result, 'SOD')  // ✅ Extracted
  const dg15RawHex = readRawHex(result, 'DG15') // ✅ Extracted

  return new EPassport({
    dg1Bytes: hexToUint8Array(dg1RawHex),      // ✅ Bytes stored
    dg15Bytes: hexToUint8Array(dg15RawHex),
    sodBytes: hexToUint8Array(sodRawHex),
    ...
  })
}
```

**Proof Generation**:

```typescript
// NoirEPassportBasedRegistrationCircuit.prove()
const inputs = {
  dg1: this.eDoc.dg1Bytes,           // ✅ Available
  dg15: this.eDoc.dg15Bytes,         // ✅ Available
  ec: this.eDoc.sod.encapsulatedContent,  // ✅ Parsed from sodBytes
  sa: this.eDoc.sod.signedAttributes,     // ✅ Parsed from sodBytes
  ...
}
```

### NID (EID — ❌ BROKEN)

**NFC Reading** → Data Exposed:

```typescript
// inid-nfc-reader only provides:
{
  signingCert: '...',  // ✅ Cert bytes (hex)
  authCert: '...'      // ✅ Cert bytes (hex)
  // ❌ NO: dg1, dg15, sodBytes
}
```

**No Adapter**:

- No conversion function exists
- Certificates stored as hex strings, not parsed
- DG bytes never extracted

**Proof Generation Attempts to Use**:

```typescript
// NoirEIDBasedRegistrationCircuit.prove() expects:
const inputs = {
  tbs: ...,                    // ✅ Can derive from cert
  pk: ...,                     // ✅ Can derive from cert
  signature: ...,              // ✅ Can derive from cert
  icao_root: ...,              // ✅ From Rarimo
  inclusion_branches: ...,     // ✅ From Rarimo
  sk_identity: ...,            // ✅ From wallet
}

// BUT: For future extensions or full validation:
// ❌ dg1Bytes not available
// ❌ dg15Bytes not available
// ❌ sodBytes not available
```

---

## APDU Commands Required to Read DG Data from Iranian NID Card

Based on INIDCA investigation and MAV4 card structure:

### Reading DG1 (Personal Data)

Iranian cards structure follows ISO 7816-4 file system:

- Master File (MF): `3F00`
- Directory File (DF) for data: `5100`
- Elementary File (EF) for each DG:
  - EF-DG1: `5031` or similar
  - EF-DG15: `5035` or similar
  - EF-SOD: `5037` or similar

**Estimated APDU sequence**:

```
SELECT MF:        00 A4 00 00 02 3F 00
SELECT DF:        00 A4 00 00 02 51 00
SELECT EF-DG1:    00 A4 02 00 02 50 31    (or appropriate EF tag)
READ BINARY:      00 B0 00 00 [length]
```

---

## Implementation Plan: Phase 1 (Critical for Proof Generation)

### Step 1: Extend inid-nfc-reader.ts

**File**: `src/utils/e-document/inid-nfc-reader.ts`

**Add Functions**:

```typescript
export async function readNidDataGroups(): Promise<{
  dg1Bytes?: Uint8Array // Personal data (names, dates, document number)
  dg15Bytes?: Uint8Array // Public key
  sodBytes?: Uint8Array // Signed Object Digest (cert + hashes)
}>

export async function readSigningCertDgAndSod(): Promise<{
  signingCert: string | null
  authCert: string | null
  dg1Bytes?: Uint8Array
  dg15Bytes?: Uint8Array
  sodBytes?: Uint8Array
}>
```

**Changes**:

- Add APDU command constants for DG file selection (EF-DG1, EF-DG15, EF-SOD)
- Implement `readFile()` invocations for each DG
- Return raw bytes (not hex) in Uint8Array form
- Wrap all in single `withIsoDep()` session to minimize card interactions

**Testing Approach**:

- Test with mock returns first (dummy byte arrays)
- Will require physical Iranian NID card for real validation

---

### Step 2: Extend NidNfcReadResult Type

**File**: `packages/nid-verification/src/types/index.ts`

**Current**:

```typescript
export type NidNfcReadResult = {
  status: NidNfcReadStatus
  nationalId?: NidEvidenceField<string>
  firstName?: NidEvidenceField<string>
  lastName?: NidEvidenceField<string>
  birthDate?: NidEvidenceField<string>
  cardNumber?: NidEvidenceField<string>
  expiryDate?: NidEvidenceField<string>
  signingCertHex?: string
  authCertHex?: string
  debug?: Record<string, unknown>
}
```

**Updated**:

```typescript
export type NidNfcReadResult = {
  status: NidNfcReadStatus

  // Identity fields (extracted)
  nationalId?: NidEvidenceField<string>
  firstName?: NidEvidenceField<string>
  lastName?: NidEvidenceField<string>
  birthDate?: NidEvidenceField<string>
  cardNumber?: NidEvidenceField<string>
  expiryDate?: NidEvidenceField<string>

  // Raw certificates (hex, parsed to ASN.1 in adapter)
  signingCertHex?: string
  authCertHex?: string

  // NEW: Raw data group bytes (required for proof generation)
  dg1Bytes?: Uint8Array // Personal data
  dg15Bytes?: Uint8Array // Public key
  sodBytes?: Uint8Array // Signed Object Digest

  debug?: Record<string, unknown>
}
```

**Rationale**:

- Parallel structure to passport's `PassportNfcReadResult`
- Exposes raw bytes so adapter can process them
- Optional fields (cards may not have DG15, SOD varies)

---

### Step 3: Update readLiveNidNfc in ScanNfcStep.tsx

**File**: `src/pages/app/pages/document-scan/components/ScanNfcStep.tsx`

**Current**:

```typescript
const readLiveNidNfc = useCallback(async (input: ReadNidNfcInput): Promise<NidNfcReadResult> => {
  const { signingCert, authCert } = await readSigningAndAuthCertificates()
  return {
    status: hasSigningCert && hasAuthCert ? 'success' : 'failed',
    signingCertHex: signingCert ?? undefined,
    authCertHex: authCert ?? undefined,
    // ❌ No DG data
  }
}, [])
```

**Updated**:

```typescript
const readLiveNidNfc = useCallback(async (input: ReadNidNfcInput): Promise<NidNfcReadResult> => {
  const expectedNationalId = normalizeNationalId(input.expectedNationalId)

  try {
    // NEW: Call extended function that returns DG + cert data
    const {
      signingCert,
      authCert,
      dg1Bytes, // NEW
      dg15Bytes, // NEW
      sodBytes, // NEW
    } = await readSigningCertDgAndSod()

    const hasSigningCert = Boolean(signingCert)
    const hasAuthCert = Boolean(authCert)
    const status = hasSigningCert && hasAuthCert ? 'success' : 'failed'

    return {
      status,
      nationalId: expectedNationalId
        ? { value: expectedNationalId, source: 'derived', confidence: 0.9 }
        : undefined,
      signingCertHex: signingCert ?? undefined,
      authCertHex: authCert ?? undefined,
      dg1Bytes, // NEW
      dg15Bytes, // NEW
      sodBytes, // NEW
      debug: {
        backend: 'inid-nfc-reader',
        hasAuthCert,
        hasSigningCert,
        mocked: false,
        readAt: Date.now(),
      },
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error('Failed to read NID NFC chip.')
  }
}, [])
```

---

### Step 4: Create NID NFC Result Adapter

**File**: `src/pages/app/pages/document-scan/adapters/nidNfcResultToEID.ts` (NEW)

**Purpose**: Convert `NidNfcReadResult` to `EID` object compatible with proof generation

**Implementation**:

```typescript
import type { NidNfcReadResult } from '@iland/nid-verification'
import { AsnConvert } from '@peculiar/asn1-schema'
import { Certificate } from '@peculiar/asn1-x509'
import { EID } from '@/utils/e-document/e-document'
import { ExtendedCertificate } from '@/utils/e-document/extended-cert'

export class NidNfcMappingError extends Error {
  public readonly code: 'MISSING_CERT' | 'INVALID_HEX' | 'INVALID_CERT'

  constructor(code: 'MISSING_CERT' | 'INVALID_HEX' | 'INVALID_CERT', message: string) {
    super(message)
    this.name = 'NidNfcMappingError'
    this.code = code
  }
}

const hexToUint8Array = (hex: string): Uint8Array => {
  const normalized = hex.trim()
  if (normalized.length === 0 || normalized.length % 2 !== 0 || /[^a-fA-F0-9]/.test(normalized)) {
    throw new NidNfcMappingError('INVALID_HEX', 'NFC payload contains invalid hex data.')
  }
  const bytes = normalized.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) ?? []
  return new Uint8Array(bytes)
}

export function nidNfcResultToEID(result: NidNfcReadResult): EID {
  // Validate required certificates exist
  if (!result.signingCertHex) {
    throw new NidNfcMappingError('MISSING_CERT', 'NFC read did not return signing certificate.')
  }
  if (!result.authCertHex) {
    throw new NidNfcMappingError('MISSING_CERT', 'NFC read did not return auth certificate.')
  }

  try {
    // Parse certificate hex to ASN.1 Certificate objects
    const sigCertBytes = hexToUint8Array(result.signingCertHex)
    const authCertBytes = hexToUint8Array(result.authCertHex)

    const sigCert = AsnConvert.parse(sigCertBytes, Certificate)
    const authCert = AsnConvert.parse(authCertBytes, Certificate)

    // Create EID (Extended Certificate wrapper required by proof circuit)
    const eid = new EID(new ExtendedCertificate(sigCert), new ExtendedCertificate(authCert))

    // Store DG bytes on EID for future use (if needed)
    if (result.dg1Bytes) {
      ;(eid as any).dg1Bytes = result.dg1Bytes
    }
    if (result.dg15Bytes) {
      ;(eid as any).dg15Bytes = result.dg15Bytes
    }
    if (result.sodBytes) {
      ;(eid as any).sodBytes = result.sodBytes
    }

    return eid
  } catch (error) {
    if (error instanceof NidNfcMappingError) throw error
    throw new NidNfcMappingError(
      'INVALID_CERT',
      `Failed to parse NFC certificates: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
  }
}
```

---

### Step 5: Wire Adapter in Proof Generation

**File**: `src/pages/app/pages/document-scan/components/ScanNfcStep.tsx`

**Update `handleComplete`**:

```typescript
const handleComplete = (result: NidVerificationResult) => {
  setNidVerificationResult(result)

  if (!result.verified) {
    ErrorHandler.process(
      new Error('NID verification did not pass'),
      'NID verification did not pass validation checks.',
    )
    return
  }

  // NEW: Convert NFC result to EID for proof generation
  try {
    const nidEid = nidNfcResultToEID(result.nfc)
    // Store EID so createIdentity() can use it
    setTempEDoc(nidEid)
  } catch (error) {
    ErrorHandler.process(
      error instanceof Error ? error : new Error('Failed to convert NFC data'),
      'Could not process NID document data.',
    )
    return
  }

  // Continue to face verification
  setPassportNfcDetails({...})
  resetFaceVerification()
  setCurrentStep(Steps.FaceLivenessStep)
}
```

---

### Step 6: Update ScanProvider.createIdentity()

**File**: `src/pages/app/pages/document-scan/ScanProvider/index.tsx`

**Ensure EID is passed correctly**:

```typescript
const createIdentity = useCallback(async () => {
  if (!tempEDoc) {
    throw new Error('EDocument is not set')
  }

  // Both passport and EID paths now should work
  const strategy = selectedDocType === DocType.PASSPORT ? epassportRegistration : eidRegistration

  const [identityItem, registrationError] = await tryCatch(
    strategy.createIdentity(tempEDoc as EPassport, privateKey, publicKeyHash, {
      onDownloading: () => setCreatingIdentityStep(GenProofSteps.DownloadCircuit),
      onGenerateProof: () => setCreatingIdentityStep(GenProofSteps.GenerateProof),
      onRegister: () => setCreatingIdentityStep(GenProofSteps.CreateProfile),
    }),
  )
  // ... rest unchanged
}, [addIdentity, faceVerification, privateKey, publicKeyHash, selectedDocType, tempEDoc])
```

---

## Data Flow After Implementation

```
✅ FIXED PATH:

1. ScanNfcStep.tsx
   └─ readLiveNidNfc()
      └─ readSigningCertDgAndSod()  (EXTENDED)
         └─ inid-nfc-reader.ts (EXTENDED with DG reading)
            └─ Returns: { signingCert, authCert, dg1Bytes, dg15Bytes, sodBytes }

2. NidNfcReadResult  (UPDATED TYPE)
   └─ status, nationalId, signingCertHex, authCertHex
   └─ ✅ dg1Bytes, dg15Bytes, sodBytes  (NEW)

3. handleComplete() (IN ScanNfcStep)
   └─ nidNfcResultToEID()  (NEW ADAPTER)
      └─ Creates EID with parsed certificates
      └─ Stores DG bytes for future validation

4. ScanProvider.createIdentity()
   └─ NoirEIDRegistration.createIdentity(tempEDoc as EID)
      └─ EID object has proper Certificate ASN.1 objects
      └─ DG bytes available if needed

5. NoirEIDBasedRegistrationCircuit.prove()
   └─ Extracts: tbs, pk, signature, len from EID certificates
   └─ Uses: icao_root, inclusion_branches from Rarimo
   └─ Signs: sk_identity from wallet
   └─ ✅ All required inputs available

6. relayerRegister()
   └─ Sends proof + callData to Rarimo
   └─ ✅ Transaction succeeds
```

---

## Risk Analysis

| Risk                                               | Likelihood | Impact                     | Mitigation                                                 |
| -------------------------------------------------- | ---------- | -------------------------- | ---------------------------------------------------------- |
| APDU commands differ from standard (card-specific) | Medium     | Proof gen fails            | Test with actual card early; document exact AID/EF paths   |
| DG extraction takes too long (timeout)             | Low        | NFC session fails          | Tune READ_BINARY `maxLe` parameter; add progress callbacks |
| EID struct incompatible with proof circuit         | Low        | Proof gen fails            | Circuit was designed for EID; minor additions only         |
| Backwards compat: old NID flow breaks              | Low        | Regression                 | Mock NFC still returns minimal data; adapter handles both  |
| iOS/Android platform differences in NFC            | Medium     | Platform-specific failures | Test on both; use Platform.OS checks if needed             |

---

## Testing Strategy

### Unit Tests

- [ ] `hexToUint8Array()` validation (valid/invalid hex)
- [ ] `nidNfcResultToEID()` with full/partial DG data
- [ ] APDU command hex string generation

### Integration Tests

- [ ] Mock `readSigningCertDgAndSod()` returning full data → EID creation succeeds
- [ ] Mock Rarimo SMT calls → Proof generation completes
- [ ] End-to-end: NID flow → face verification → proof generation → registration

### Manual Testing (with real card)

- [ ] Verify APDU sequences work on actual Iranian NID
- [ ] Check read times; verify no timeouts
- [ ] Validate DG1 content matches displayed identity
- [ ] Verify proof generation uses DG bytes correctly

---

## Success Criteria

✅ **Proof Generation Succeeds**:

- `NoirEIDBasedRegistrationCircuit.prove()` returns valid proof without errors
- No missing input errors
- Proof output accepted by Rarimo circuit verifier

✅ **Data Integrity**:

- DG1 bytes extracted from NFC contain valid personal data
- SOD bytes parse correctly as SignedData
- Certificate chains validate

✅ **Performance**:

- NFC read completes in < 30 seconds
- Proof generation completes in < 2 minutes
- No timeout errors on iOS or Android

---

## Timeline Estimate

- **Step 1 (inid-nfc-reader.ts)**: 4-6 hours (includes finding correct APDU sequences)
- **Step 2 (Type updates)**: 1 hour
- **Step 3 (readLiveNidNfc)**: 1 hour
- **Step 4 (Adapter)**: 2-3 hours
- **Step 5-6 (Integration)**: 1-2 hours
- **Testing**: 3-4 hours
- **Total**: 12-17 hours

**Blockers**:

- Need access to INIDCA source or Iranian NID APDU documentation
- Physical card for validation (optional for Phase 1 mock)

---

## Next Steps

1. **Immediate**: Implement Steps 1-4 with mock APDU responses
2. **Parallel**: Research exact APDU sequences for DG files (INIDCA reference)
3. **Phase 2** (after Step 1 proof of concept): Test with real card
4. **Phase 3**: Performance optimization & edge case handling
