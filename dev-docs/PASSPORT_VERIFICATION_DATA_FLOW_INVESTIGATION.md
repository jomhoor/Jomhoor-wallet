# Passport Verification Data Flow Investigation

**Focus**: End-to-end data journey from NFC read to proof generation  
**Date**: May 28, 2026  
**Purpose**: Understand the working passport flow to replicate for NID

---

## 1. Overview: The Complete Passport Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│ MRZ Scan (ScanMrzStep)                                          │
│ Returns: FieldRecords { documentNumber, birthDate, expiryDate } │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌─────────────────────────▼────────────────────────────────────────┐
│ NFC Read (ScanPassportNfcStep)                                   │
│ readPassportScanOutput(docNum, dob, expiry)                     │
│   → readPassportNfc(PassportNfcReadInput)                        │
│      Returns: PassportNfcReadResult {                           │
│        files: { DG1, DG2, DG15, SOD, ... }                      │
│        normalized: { name, dates, docs }                        │
│      }                                                           │
│   → packageNfcResultToEPassport(result)                         │
│      Returns: EPassport {                                       │
│        dg1Bytes, dg15Bytes, sodBytes                            │
│        personDetails: { ... }                                   │
│      }                                                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌─────────────────────────▼────────────────────────────────────────┐
│ Proof Generation (GenerateProofStep)                             │
│ ScanProvider.createIdentity(tempEDoc, privateKey)               │
│   → strategy = epassportRegistration                            │
│   → strategy.createIdentity(ePassport, privateKey, ...)         │
│   → NoirEPassportBasedRegistrationCircuit.prove({               │
│        dg1: ePassport.dg1Bytes                                  │
│        dg15: ePassport.dg15Bytes                                │
│        ec: ePassport.sod.encapsulatedContent                    │
│        sa: ePassport.sod.signedAttributes                       │
│        ...                                                      │
│      })                                                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌─────────────────────────▼────────────────────────────────────────┐
│ Rarimo Registration                                              │
│ relayerRegister(callData, contractAddress)                      │
│   → Returns: { tx_hash, ... }                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer 1: NFC Reading (passport-verification package)

### Entry Point

**File**: `packages/passport-verification/src/passport/nfc/runtime.ts`  
**Function**: `readPassportNfc(input: PassportNfcReadInput)`

```typescript
export async function readPassportNfc(input: PassportNfcReadInput): Promise<PassportNfcReadResult>
```

**Input**:
```typescript
type PassportNfcReadInput = Omit<PassportCredentials, 'mrzKey'> & {
  documentNumber: string      // 9-char from MRZ
  dateOfBirth: string         // YYMMDD
  documentExpiryDate: string  // YYMMDD
  mrzKey?: string            // BAC/PACE key (derived from above if not provided)
  backend?: PassportNfcBackend  // 'native-ios' | 'native-android'
  requestedDataGroups?: string[] // which DGs to read
  includeImageBase64?: boolean   // include portrait base64
  persistDg2ImageFile?: boolean  // save portrait to file
}
```

### How It Works

#### **Backend Selection**:
```typescript
const selectBackend = (input?: PassportNfcReadInput): PassportNfcBackend => {
  if (input?.backend) return input.backend
  const platform = getNativePlatform()
  if (platform === 'ios') return 'native-ios'
  if (platform === 'android') return 'native-android'
  return 'stub'
}
```

**Key Path**: Uses **native iOS/Android modules** to perform actual NFC reading
- iOS: `NFC.framework` (Apple's native NFC)
- Android: `android.nfc` (Android's native NFC)
- These are invoked via bridge: `invokeNativeRead(input)`

#### **Native Module Returns Raw Response**:
```typescript
// Native module returns structured payload with ALL data groups
{
  finalStatus: 'success' | 'partial_success' | 'error',
  files: {
    DG1: { status: 'ok', data: { rawHex: '...', parsed: {...} } },
    DG2: { status: 'ok', data: { rawHex: '...', imageBase64: '...' } },
    DG15: { status: 'ok', data: { rawHex: '...' } },
    SOD: { status: 'ok', data: { rawHex: '...' } },
    // ... other optional DGs
  },
  accessControl: { method: 'BAC' | 'PACE', status: 'success' },
  portrait: { base64?: '...', filePath?: '...' },
  normalized: { documentNumber, firstName, lastName, ... }
}
```

#### **Normalization in Package**:
```typescript
const normalizeReadResult = (backend: PassportNfcBackend, raw: unknown): PassportNfcReadResult => {
  const files = mapNativeFiles(payload.files)  // Extract DG data
  
  return {
    finalStatus,
    backend,
    files,  // Each file has: { status, data, base64?, filePath?, error? }
    accessControl,
    portrait,
    normalized,  // Extracted from DG1.parsed
    raw,         // Full native response preserved
  }
}
```

### Output: PassportNfcReadResult

**Key Structure**:
```typescript
type PassportNfcReadResult = {
  finalStatus: 'success' | 'partial_success' | 'error'
  backend: 'native-ios' | 'native-android'
  
  files: Record<string, PassportNfcFileResult>
  // where each file has:
  // {
  //   status: 'ok' | 'missing' | 'error'
  //   data: {
  //     rawHex?: string         // ← THE RAW BYTES WE NEED
  //     parsed?: unknown        // Parsed fields (for DG1: identity info)
  //     imageBase64?: string    // DG2 image
  //   }
  // }
  
  accessControl?: {
    method?: 'PACE' | 'BAC'
    paceStatus?: string
    bacStatus?: string
  }
  
  portrait?: {
    base64?: string    // DG2 image base64
    filePath?: string  // Saved to disk
  }
  
  normalized?: {
    documentNumber?: string
    firstName?: string
    lastName?: string
    birthDate?: string    // YYMMDD
    expiryDate?: string   // YYMMDD
    nationality?: string
    sex?: string
  }
  
  raw?: unknown  // Full native response
}
```

---

## 3. Layer 2: Adapter (Host App)

### From PassportNfcReadResult → EPassport

**File**: `src/pages/app/pages/document-scan/adapters/packageNfcResultToEPassport.ts`

**Function**:
```typescript
export function packageNfcResultToEPassport(result: PassportNfcReadResult): EPassport
```

### Conversion Logic

#### **Step 1: Extract Raw Hex Bytes**
```typescript
const readRawHex = (result: PassportNfcReadResult, key: string): string | undefined => {
  const file = readFileData(result, key)
  return typeof file?.rawHex === 'string' ? file.rawHex : undefined
}

// Extract critical DGs
const dg1RawHex = readRawHex(result, 'DG1')      // ← Machine Readable Zone
const sodRawHex = readRawHex(result, 'SOD')      // ← Signed Object Digest
const dg15RawHex = readRawHex(result, 'DG15')    // ← Public Key (optional)
const dg11RawHex = readRawHex(result, 'DG11')    // ← Personal Details (optional)
```

#### **Step 2: Validate Critical Data**
```typescript
// DG1 and SOD are REQUIRED for proof generation
if (!dg1RawHex) {
  throw new PackageNfcMappingError('MISSING_DG1', 'Native NFC read did not return DG1.')
}
if (!sodRawHex) {
  throw new PackageNfcMappingError('MISSING_SOD', 'Native NFC read did not return SOD.')
}
```

#### **Step 3: Convert Hex to Uint8Array**
```typescript
const hexToUint8Array = (hex: string): Uint8Array => {
  const normalized = hex.trim()
  // Validate hex format
  if (normalized.length === 0 || normalized.length % 2 !== 0 || /[^a-fA-F0-9]/.test(normalized)) {
    throw new PackageNfcMappingError('INVALID_HEX', 'Invalid hex data from NFC.')
  }
  // Convert to bytes
  const bytes = normalized.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) ?? []
  return new Uint8Array(bytes)
}

const dg1Bytes = hexToUint8Array(dg1RawHex)       // Binary form
const sodBytes = hexToUint8Array(sodRawHex)
const dg15Bytes = dg15RawHex ? hexToUint8Array(dg15RawHex) : undefined
const dg11Bytes = dg11RawHex ? hexToUint8Array(dg11RawHex) : undefined
```

#### **Step 4: Extract Personal Details**
```typescript
function buildPersonDetails(result: PassportNfcReadResult): PersonDetails {
  const normalized = result.normalized  // From normalized NFC result
  const parsed = readParsed(result, 'DG1')  // From parsed DG1
  const dg2 = readFileData(result, 'DG2')   // Portrait

  return {
    firstName: normalized?.firstName ?? parsed?.firstName ?? null,
    lastName: normalized?.lastName ?? parsed?.lastName ?? null,
    gender: normalized?.sex ?? parsed?.gender ?? null,
    birthDate: normalized?.birthDate ?? parsed?.dateOfBirth ?? null,
    expiryDate: normalized?.expiryDate ?? parsed?.documentExpiryDate ?? null,
    documentNumber: normalized?.documentNumber ?? parsed?.documentNumber ?? null,
    nationality: normalized?.nationality ?? parsed?.nationality ?? null,
    issuingAuthority: parsed?.issuingAuthority ?? null,
    passportImageRaw: result.portrait?.base64 ?? dg2?.imageBase64 ?? null,
  }
}
```

#### **Step 5: Create EPassport**
```typescript
return new EPassport({
  docCode: 'P',  // Passport
  personDetails: buildPersonDetails(result),
  sodBytes: hexToUint8Array(sodRawHex),      // ← Stored
  dg1Bytes: hexToUint8Array(dg1RawHex),      // ← Stored
  dg15Bytes: dg15RawHex ? hexToUint8Array(dg15RawHex) : undefined,  // ← Stored
  dg11Bytes: dg11RawHex ? hexToUint8Array(dg11RawHex) : undefined,
  aaSignature: activeAuthentication?.signature ? /* extract */ : undefined,
})
```

### Result: EPassport Object

**File**: `src/utils/e-document/e-document.ts`

```typescript
export class EPassport implements EDocument {
  docCode: string  // 'P'
  _personDetails: PersonDetails
  
  // ← THE KEY BYTES FOR PROOF GENERATION
  sodBytes: Uint8Array          // Signed Object Digest (contains hashes)
  dg1Bytes: Uint8Array          // Machine Readable Zone data
  dg15Bytes?: Uint8Array        // Public key (optional)
  dg11Bytes?: Uint8Array        // Personal details (optional)
  aaSignature?: Uint8Array      // Active authentication signature
  
  get sod(): Sod {
    return new Sod(this.sodBytes)  // Parses sodBytes into structure
  }
  
  get personDetails(): PersonDetails {
    return this._personDetails
  }
}
```

---

## 4. Layer 3: Proof Generation

### Entry Point

**File**: `src/pages/app/pages/document-scan/ScanProvider/index.tsx`

**Function**: `createIdentity()`

```typescript
const createIdentity = useCallback(async () => {
  // tempEDoc is set via setPassportNfcScanOutput → setTempEDoc
  if (!tempEDoc) throw new Error('EDocument is not set')
  
  // Select strategy based on document type
  const strategy = selectedDocType === DocType.PASSPORT ? epassportRegistration : eidRegistration
  
  // Create identity (generates proof + registers to Rarimo)
  const [identityItem, registrationError] = await tryCatch(
    strategy.createIdentity(tempEDoc as EPassport, privateKey, publicKeyHash, {
      onDownloading: () => setCreatingIdentityStep(GenProofSteps.DownloadCircuit),
      onGenerateProof: () => setCreatingIdentityStep(GenProofSteps.GenerateProof),
      onRegister: () => setCreatingIdentityStep(GenProofSteps.CreateProfile),
    }),
  )
}, [...])
```

### Proof Generation Path: NoirEPassportRegistration

**File**: `src/api/modules/registration/variants/noir-epassport.ts`

#### **createIdentity() flow**:

1. **Validate EPassport**:
   ```typescript
   if (eDocument.sodBytes.length === 0 || eDocument.dg1Bytes.length === 0) {
     throw new TypeError('Passport NFC result is missing required DG/SOD bytes')
   }
   ```

2. **Fetch CSCA (Country Signing CA) chain**:
   ```typescript
   const CSCACertBytes = await RegistrationStrategy.retrieveCSCAFromPem()
   ```

3. **Parse SOD and get certificate**:
   ```typescript
   const slaveCertificate = eDocument.sod.slaveCertificate
   // sod is parsed from sodBytes
   ```

4. **Get SMT proof from Rarimo** (verifies certificate is registered):
   ```typescript
   const slaveCertSmtProof = await RegistrationStrategy.getSlaveCertSmtProof(slaveCertificate)
   // Returns: { root, siblings, existence }
   ```

5. **Register certificate if needed**:
   ```typescript
   if (!slaveCertSmtProof.existence) {
     // If cert not yet on Rarimo, register it first
     await RegistrationStrategy.registerCertificate(CSCACertBytes, slaveCertificate, slaveMaster)
   }
   ```

6. **Generate Noir proof**:
   ```typescript
   const registrationProof = await circuit.prove({
     skIdentity: BigInt(`0x${privateKey}`),
     icaoRoot: BigInt(slaveCertSmtProof.root),
     inclusionBranches: slaveCertSmtProof.siblings.map(el => BigInt(el)),
   })
   ```

### Noir Circuit Input

**File**: `src/utils/circuits/registration/noir-registration-circuit.ts`

#### **NoirEPassportBasedRegistrationCircuit.prove()**:

```typescript
async prove(params: {
  skIdentity: bigint
  icaoRoot: bigint
  inclusionBranches: bigint[]
}): Promise<NoirZKProof> {
  // Download trusted setup and bytecode
  await NoirCircuitParams.downloadTrustedSetup()
  const byteCode = await this.noirCircuitParams.downloadByteCode()
  
  // Prepare circuit inputs FROM EPASSPORT
  const inputs = {
    // ← From EPassport.dg1Bytes
    dg1: this.eDoc.dg1Bytes,
    
    // ← From EPassport.dg15Bytes (optional)
    dg15: this.eDoc.dg15Bytes,
    
    // ← From EPassport.sod (parsed sodBytes)
    ec: this.eDoc.sod.encapsulatedContent,    // Hashes of all DGs
    sa: this.eDoc.sod.signedAttributes,       // Signed attributes
    
    // ← From certificate public key (extracted)
    pk: this.chunkedParams.pk_chunked,        // Public key chunks
    reduction: this.chunkedParams.reduction,  // Barret reduction
    sig: this.chunkedParams.sig_chunked,      // Signature chunks
    
    // ← From parameters
    sk_identity: params.skIdentity,           // User's wallet key
    icao_root: params.icaoRoot,               // From Rarimo SMT
    inclusion_branches: params.inclusionBranches,  // From Rarimo SMT
  }
  
  // Call Noir prover
  return this.noirCircuitParams.prove(JSON.stringify(inputs), byteCode)
}
```

### Data Dependencies for Proof

| Input | Source | Type | Why Needed |
|-------|--------|------|-----------|
| `dg1` | EPassport.dg1Bytes | Uint8Array | Prove passport data integrity |
| `dg15` | EPassport.dg15Bytes | Uint8Array | Public key validation (optional) |
| `ec` | EPassport.sod.encapsulatedContent | Uint8Array | Signed object digest hashes |
| `sa` | EPassport.sod.signedAttributes | Uint8Array | Signature over DGs |
| `pk` | Certificate public key | string[] (chunked) | Signature verification |
| `reduction` | Computed from pk | string[] (chunked) | Barret reduction for RSA |
| `sig` | Certificate signature | string[] (chunked) | Certificate signature |
| `sk_identity` | User's wallet | bigint | Sign the proof |
| `icao_root` | Rarimo SMT root | bigint | Certificate chain validation |
| `inclusion_branches` | Rarimo SMT siblings | bigint[] | Certificate inclusion proof |

---

## 5. Data Flow Diagram: Where Each Piece Comes From

```
┌─────────────────────────────────────────────────────────────────┐
│ Native NFC Module (iOS/Android)                                 │
│  - Reads passport over NFC                                      │
│  - Performs BAC/PACE key derivation                             │
│  - Reads DG1, DG2, DG15, SOD files                              │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ passport-verification package                                   │
│ readPassportNfc() [runtime.ts]                                  │
│  - Normalizes native response                                   │
│  - Extracts: files { DG1.rawHex, DG15.rawHex, SOD.rawHex, ... }│
│  - Extracts: normalized { firstName, birthDate, ... }          │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼  PassportNfcReadResult
         │
┌─────────────────────────────────────────────────────────────────┐
│ Host App Adapter [packageNfcResultToEPassport.ts]               │
│  - Extract rawHex strings from files                            │
│  - Validate DG1, SOD present                                    │
│  - Convert hex → Uint8Array (dg1Bytes, dg15Bytes, sodBytes)     │
│  - Extract personDetails from DG1.parsed                        │
│  - Create EPassport with all bytes                              │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼  EPassport {
         │    dg1Bytes,
         │    dg15Bytes,
         │    sodBytes,
         │    personDetails,
         │    aaSignature
         │  }
         │
┌────────▼────────────────────────────────────────────────────────┐
│ Proof Generation [noir-epassport.ts]                            │
│  - Extract from EPassport:                                      │
│    • dg1Bytes → circuit input                                   │
│    • dg15Bytes → circuit input                                  │
│    • sodBytes → parse Sod → encapsulatedContent + signedAttr   │
│    • certificate → parse to get public key                      │
│  - Fetch from Rarimo:                                           │
│    • ICAO root (SMT root)                                       │
│    • Inclusion branches (certificate proof)                     │
│  - Get from wallet:                                             │
│    • Private key (sk_identity)                                  │
│  - Generate Noir proof with all inputs                          │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼  NoirZKProof
         │
┌────────▼────────────────────────────────────────────────────────┐
│ Rarimo Registration [relayer.ts]                                │
│  - Encode: registerViaNoir(root, pkHash, dg1Commitment, ...)    │
│  - Send via relayer                                             │
│  - Wait for transaction confirmation                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Key Files in Passport Flow

| Layer | File | Key Function | Output |
|-------|------|--------------|--------|
| **NFC** | `packages/passport-verification/src/passport/nfc/runtime.ts` | `readPassportNfc()` | `PassportNfcReadResult` |
| **Adapter** | `src/pages/app/pages/document-scan/adapters/packageNfcResultToEPassport.ts` | `packageNfcResultToEPassport()` | `EPassport` |
| **Storage** | `src/utils/e-document/e-document.ts` | `class EPassport` | `.dg1Bytes`, `.dg15Bytes`, `.sodBytes` |
| **Proof Gen** | `src/utils/circuits/registration/noir-registration-circuit.ts` | `NoirEPassportBasedRegistrationCircuit.prove()` | `NoirZKProof` |
| **Registration** | `src/api/modules/registration/variants/noir-epassport.ts` | `NoirEPassportRegistration.createIdentity()` | Proof + Rarimo registration |
| **Rarimo** | `src/api/modules/registration/relayer.ts` | `relayerRegister()` | Transaction hash |

---

## 7. What Happens at Each Transformation

### PassportNfcReadResult → EPassport Transformation

```
Input (PassportNfcReadResult):
{
  files: {
    DG1: {
      data: {
        rawHex: "3082019f30820105a00302..."  // ← 40KB hex string
        parsed: {
          documentNumber: "L898902C",
          firstName: "HENRIKA",
          lastName: "SZILVÁSSY",
          birthDate: "600721",
          documentExpiryDate: "200101",
          ...
        }
      }
    },
    SOD: {
      data: {
        rawHex: "308203e206092a864886f70d010702..."  // ← 1MB+ hex string
      }
    },
    DG15: {
      data: {
        rawHex: "30820122300d060960864801650304020105..."
      }
    }
  },
  normalized: {
    documentNumber: "L898902C",
    firstName: "HENRIKA",
    lastName: "SZILVÁSSY",
    birthDate: "600721",
    expiryDate: "200101",
    ...
  }
}

↓ packageNfcResultToEPassport()

Output (EPassport):
{
  docCode: 'P',
  
  // Binary forms (Uint8Array)
  dg1Bytes: Uint8Array[20000] // Binary form of DG1 hex
  dg15Bytes: Uint8Array[1024]
  sodBytes: Uint8Array[500000]
  
  personDetails: {
    firstName: "HENRIKA",
    lastName: "SZILVÁSSY",
    birthDate: "600721",
    expiryDate: "200101",
    documentNumber: "L898902C",
    ...
  },
  
  aaSignature: undefined, // Will be filled from activeAuthentication if present
}
```

### How Sod is Parsed

```typescript
// EPassport stores sodBytes (Uint8Array)
// On access via .sod getter:

get sod(): Sod {
  return new Sod(this.sodBytes)
}

// Sod class parses the ASN.1 SignedData structure
class Sod {
  constructor(sodBytes: Uint8Array) {
    const signedData = AsnConvert.parse(sodBytes, SignedData)
    this.encapsulatedContent = signedData.contentInfo.content  // ← hashes
    this.signedAttributes = signedData.signerInfos[0].signedAttributes  // ← signed attrs
    this.slaveCertificate = extractCertFromSignerInfo(...)  // ← auth cert
    this.signatures = [...]  // All signatures
  }
  
  encapsulatedContent: Uint8Array   // Contains hash of each DG
  signedAttributes: Uint8Array      // What was signed
  slaveCertificate: ExtendedCertificate
  signatures: Signature[]
}
```

---

## 8. Critical Insight: Passport Flow Success Factors

### Why Passport Works:

1. ✅ **Native NFC module** extracts ALL data groups (DG1, DG15, SOD) as hex strings
2. ✅ **Adapter function** `packageNfcResultToEPassport()` converts hex → Uint8Array + parses
3. ✅ **EPassport class** stores dg1Bytes, dg15Bytes, sodBytes properties
4. ✅ **Proof circuit** accesses `ePassport.dg1Bytes` and `ePassport.sod` directly
5. ✅ **No gaps** in data flow from NFC → adapter → storage → proof generation

### Why NID Currently Fails:

1. ❌ `inid-nfc-reader.ts` only reads signing + auth certificates (no DG data)
2. ❌ No adapter function exists (would be `nidNfcResultToEID()`)
3. ❌ `NidNfcReadResult` has no dg1Bytes, dg15Bytes, sodBytes fields
4. ❌ `createIdentity()` tries to use EID with certificates but no DG data
5. ❌ **Gap**: Proof circuit receives certificate objects but no DG bytes to validate

---

## 9. Mapping: How to Replicate Passport Flow for NID

| Passport Component | File | NID Equivalent | Status |
|-------------------|------|---|--------|
| Native iOS/Android NFC module | (built-in) | inid-nfc-reader + native module | ❌ Only reads certs |
| `readPassportNfc()` | passport-verification pkg | `readLiveNidNfc()` | ❌ Doesn't call DG reading |
| `PassportNfcReadResult` type | passport-verification pkg | `NidNfcReadResult` type | ❌ Missing DG fields |
| `packageNfcResultToEPassport()` | adapters/ | `nidNfcResultToEID()` | ❌ Doesn't exist |
| `EPassport` storage | e-document.ts | `EID` class | ⚠️ No DG byte fields |
| Proof circuit access | noir-registration-circuit.ts | Same circuit | ❌ Receives empty/null DG data |

---

## 10. Step-by-Step Replication

### What Passport Does
1. Native module reads and extracts DG1, DG15, SOD as hex
2. `readPassportNfc()` normalizes and returns `PassportNfcReadResult` with all hex strings
3. Adapter converts hex → Uint8Array and validates
4. EPassport stores binary bytes
5. Proof circuit uses `ePassport.dg1Bytes`, `ePassport.dg15Bytes`, `ePassport.sod`

### What NID Needs to Do
1. **Extend inid-nfc-reader.ts**: Add `readNidDataGroups()` to extract DG1, DG15, SOD
2. **Extend NidNfcReadResult**: Add `dg1Bytes`, `dg15Bytes`, `sodBytes` fields
3. **Create adapter**: `nidNfcResultToEID()` to convert hex to Uint8Array
4. **Extend EID (optional)**: Add DG byte properties if needed for validation
5. **Wire in ScanNfcStep**: Update `readLiveNidNfc()` to collect DG bytes
6. **Pass to createIdentity**: EID with proper structure goes to proof generation

---

## 11. Summary: The Working Model

```typescript
// PASSPORT (WORKING)
const passportNfcResult = await readPassportNfc(input)
// → Has: files.DG1.data.rawHex, files.DG15.data.rawHex, files.SOD.data.rawHex

const ePassport = packageNfcResultToEPassport(passportNfcResult)
// → Has: dg1Bytes, dg15Bytes, sodBytes (Uint8Array forms)

const proof = circuit.prove({
  dg1: ePassport.dg1Bytes,        // ✅ Available
  dg15: ePassport.dg15Bytes,      // ✅ Available
  ec: ePassport.sod.encapsulatedContent,  // ✅ Available
  sa: ePassport.sod.signedAttributes,     // ✅ Available
  ...
})

// NID (BROKEN)
const nidNfcResult = await readLiveNidNfc(input)
// → Has: signingCertHex, authCertHex
// → Missing: dg1Bytes, dg15Bytes, sodBytes ❌

const eid = new EID(signingCert, authCert)
// → No: dg1Bytes, dg15Bytes, sodBytes

const proof = circuit.prove({
  dg1: undefined,        // ❌ Not available
  dg15: undefined,       // ❌ Not available
  ec: undefined,         // ❌ Not available
  sa: undefined,         // ❌ Not available
  ...
})
```

This gap is why proof generation fails for NID.

