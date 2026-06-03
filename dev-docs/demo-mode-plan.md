# Demo Mode Implementation Plan

**Status**: Planning Phase  
**Purpose**: Enable Apple Store reviewers to test the verification flow without real passport/NFC documents  
**Estimated Timeline**: 3-5 sprints  
**Feasibility**: ✅ High - Clean architecture allows injection of demo data

---

## Overview

Demo mode provides a complete alternative verification flow that mimics the real process but with:

- Auto-filled document data after 3-second delays
- Real face capture and biometric detection
- Mock proof generation and registration
- Total flow completion time: 2-3 minutes

---

## Current State

### Architecture

- **Context**: `ScanProvider/index.tsx` manages all verification state
- **Country Selection**: `SelectPassportCountryStep.tsx`
- **Document Scanning**: `ScanMrzStep.tsx` (MRZ/barcode OCR)
- **NFC Reading**: `ScanPassportNfcStep.tsx`
- **Face Verification**: Three steps (liveness, gaze, comparison)
- **Proof Generation**: `GenerateProofStep.tsx` + `ScanProvider.createIdentity()`

### Key Insight

All verification steps flow through `VerificationUserData` context - demo mode can inject data at context level without changing step logic.

---

## Implementation Plan

### Phase 1: Foundation

#### 1.1 Add Demo Flag to Context (`ScanProvider/index.tsx`)

**Changes**:

```typescript
// Add to DocumentScanContext type
type DocumentScanContext = {
  isDemoMode: boolean
  setIsDemoMode: (value: boolean) => void
  // ... existing properties
}

// Add state
const [isDemoMode, setIsDemoMode] = useState(false)

// Add to context value
{
  isDemoMode,
  setIsDemoMode,
  // ... existing values
}
```

**Impact**: Minimal - purely additive, no logic changes

#### 1.2 Create Demo Data Module (`src/utils/demo-data.ts`)

**File Structure**:

```typescript
// Demo data constants
export const DEMO_MRZ_DATA = { ... }
export const DEMO_BARCODE_DATA = { ... }
export const DEMO_PASSPORT_DETAILS = { ... }
export const DEMO_PROOF_STRUCTURE = { ... }

// Helper functions
export function createDemoPassport(): EPassport { ... }
export function createDemoProof(): NoirZKProof { ... }
export function createDemoIdentity(): IdentityItem { ... }
```

**Demo Data Content**:

- MRZ: Iranian passport format (demo person: "AMIR DEMOUSERYAN")
- Document Number: N12345678
- DOB: 1990-05-15
- Expiry: 2030-12-31
- Barcode: Valid NIDN structure

#### 1.3 Create Demo Passport Builder (`src/utils/demo-passport-builder.ts`)

**Purpose**: Build realistic EPassport object with:

- Valid DG1 bytes (MRZ data)
- Valid DG15 bytes (AA public key)
- Valid SOD bytes (security object)
- Valid person details
- Realistic certificate chain

**Key**: EPassport structure must match real passport format for proof generation to work

---

### Phase 2: UI Integration

#### 2.1 Country Selection (`SelectPassportCountryStep.tsx`)

**Changes**:

```typescript
const PASSPORT_COUNTRY_OPTIONS: PassportCountryOption[] = [
  { code: 'DEMO', name: '🎬 Demo Mode (for App Review)' }, // Add at top
  { code: 'IRN', name: 'Iran ایران' },
  // ... rest of countries
]

// Modify continueToMrz to set demo flag
const continueToMrz = (countryCode: string) => {
  if (countryCode === 'DEMO') {
    setIsDemoMode(true)
  }
  setPassportCountryCode(countryCode)
  setCurrentStep(Steps.ScanMrzStep)
}
```

**UX**: Single tap to enter demo mode, no alerts needed

#### 2.2 MRZ + Barcode Scanning (`ScanMrzStep.tsx`)

**Changes**:

```typescript
// Add effect that fires 3 seconds after component mounts if isDemoMode
useEffect(() => {
  if (!isDemoMode) return

  const timer = setTimeout(() => {
    // Auto-fill with demo data
    setPassportMrzBarcode({
      credentials: demoData.credentials,
      parsedMrz: demoData.parsedMrz,
      barcode: demoData.barcode,
    })
    // Auto-navigate to NFC step
    setCurrentStep(Steps.ScanPassportNfcStep)
  }, 3000)

  return () => clearTimeout(timer)
}, [isDemoMode])
```

**UX**:

- Show normal camera for 3 seconds (appears authentic)
- Auto-advance to NFC reading step
- No user interaction required

#### 2.3 NFC Reading (`ScanPassportNfcStep.tsx`)

**Changes**:

```typescript
// Add effect for demo NFC auto-completion
useEffect(() => {
  if (!isDemoMode) return

  const timer = setTimeout(() => {
    const demoPassport = createDemoPassport()
    setPassportNfcScanOutput({
      ePassport: demoPassport,
      normalized: demoPassport.personDetails,
      portrait: { base64: demoPortraitBase64 },
    })
    // Auto-navigate to liveness detection
    setCurrentStep(Steps.FaceLivenessStep)
  }, 3000)

  return () => clearTimeout(timer)
}, [isDemoMode])
```

**UX**:

- Show "Reading NFC..." loading state
- Auto-complete after 3 seconds
- No NFC hardware required

#### 2.4 Face Liveness & Gaze

**Changes**: None required

- Let reviewers capture real face (tests camera integration)
- Use real liveness and gaze detection
- Demo mode will auto-pass comparison regardless of results

#### 2.5 Face Comparison (`FaceComparisonStep.tsx`)

**Changes**:

```typescript
// Modify the automatic face preparation logic
useEffect(() => {
  if (comparisonState === 'ready' && !isBusy) {
    if (isDemoMode) {
      // Demo mode: use live image as both reference and live
      setVerificationUserData(previous => ({
        ...previous,
        biometrics: {
          ...previous.biometrics,
          images: {
            referenceUri: liveCaptureUri, // Copy to reference
            liveCaptureUri: liveCaptureUri,
            referenceCropUri: liveCaptureUri,
            liveCropUri: liveCaptureUri,
          },
          comparison: {
            passed: true,
            similarity: 0.99, // Demo high confidence
            threshold: DEFAULT_FACE_COMPARISON_THRESHOLD,
          },
        },
      }))
      setComparisonState('cropped')
      // Auto-proceed to comparison
      setTimeout(() => {
        handleComparePrepared()
      }, 500)
    } else {
      // Real mode: proceed with actual preparation
      void handleCaptureAndPrepare()
    }
  }
}, [comparisonState, isBusy, isDemoMode, liveCaptureUri])
```

**UX**:

- Show normal face comparison UI
- Use actual live capture for both images
- Skip comparison algorithm
- Auto-pass with high confidence

---

### Phase 3: Proof Generation

#### 3.1 Modify createIdentity (`ScanProvider/index.tsx`)

**Changes**:

```typescript
const createIdentity = useCallback(async () => {
  // ... existing validation code ...

  try {
    // Check if demo mode
    if (isDemoMode) {
      logIdentityDiagnostic('IdentityProof', 'createIdentity:demo-mode', {
        docType: selectedDocType,
      })

      // Create demo identity
      const demoIdentity = createDemoIdentity(selectedDocType, verificationUserData)

      // Store demo identity (no blockchain registration)
      addIdentity(demoIdentity)
      setIdentity(demoIdentity)

      // Update verification data
      setVerificationUserData(previous => ({
        ...previous,
        proof: {
          ...previous.proof,
          creatingIdentityStep: GenProofSteps.Final,
          identity: demoIdentity,
        },
        session: {
          ...previous.session,
          status: 'completed',
          isDemoMode: true,
        },
      }))

      return // Skip real proof generation
    }

    // Real mode: proceed with actual proof generation
    // ... existing code ...
  } catch (error) {
    // ... existing error handling ...
  }
}, [isDemoMode /* ... other deps ... */])
```

#### 3.2 Update GenerateProofStep

**Changes**:

```typescript
useEffect(() => {
  if (!isDemoMode || creatingIdentityStep !== GenProofSteps.DownloadCircuit) return

  // Auto-advance through steps with 3-second delays
  const timers = [
    setTimeout(() => {
      setCreatingIdentityStep(GenProofSteps.GenerateProof)
    }, 3000),
    setTimeout(() => {
      setCreatingIdentityStep(GenProofSteps.CreateProfile)
    }, 6000),
    setTimeout(() => {
      setCreatingIdentityStep(GenProofSteps.Final)
    }, 9000),
  ]

  return () => timers.forEach(timer => clearTimeout(timer))
}, [isDemoMode, creatingIdentityStep])
```

**UX**:

- Show normal progress UI
- Auto-advance: DownloadCircuit → GenerateProof → CreateProfile → Final
- Each step shows 3-second progress
- Total: 9 seconds

---

## New Files to Create

### 1. `src/utils/demo-data.ts`

```
Exports:
- DEMO_MRZ_CREDENTIALS
- DEMO_PARSED_MRZ
- DEMO_BARCODE_DATA
- DEMO_PERSON_DETAILS
- DEMO_FACE_IMAGE_BASE64
```

### 2. `src/utils/demo-passport-builder.ts`

```
Exports:
- createDemoEPassport(docType: DocType): EPassport
- createDemoDG1Bytes(): Uint8Array
- createDemoDG15Bytes(): Uint8Array
- createDemoSODBytes(): Uint8Array
```

### 3. `src/utils/demo-identity-builder.ts`

```
Exports:
- createDemoIdentity(docType, verificationData): IdentityItem
- createDemoProof(): NoirZKProof
```

---

## Files to Modify

| File                            | Changes                                     | Complexity |
| ------------------------------- | ------------------------------------------- | ---------- |
| `SelectPassportCountryStep.tsx` | Add DEMO option to countries list           | Low        |
| `ScanMrzStep.tsx`               | Add 3-second auto-fill effect               | Medium     |
| `ScanPassportNfcStep.tsx`       | Add 3-second auto-complete effect           | Medium     |
| `FaceComparisonStep.tsx`        | Copy live image, skip comparison            | Low        |
| `ScanProvider/index.tsx`        | Add isDemoMode state, modify createIdentity | High       |
| `GenerateProofStep.tsx`         | Auto-advance steps with timers              | Medium     |

---

## Demo User Flow

```
1. Select "🎬 Demo Mode" from country list
   ↓
2. Camera shows for 3 seconds (auto-fills MRZ/barcode)
   ↓
3. NFC reading shows for 3 seconds (auto-completes)
   ↓
4. Face liveness detection (real camera, ~10 seconds)
   ↓
5. Face gaze challenge (real gaze, ~10 seconds)
   ↓
6. Face comparison (auto-passes, shows demo images)
   ↓
7. Proof generation UI auto-advances (9 seconds total)
   ↓
8. Success screen (demo identity created)
   ↓
9. Click "Home Page"
   ↓
10. Data deletion confirmation
    ↓
11. Return to main screen

Total time: 2-3 minutes
```

---

## Data Isolation

### Demo vs Real Identities

- Both stored in same secure storage
- Demo flag in identity metadata: `identity.metadata.isDemoMode = true`
- Reviewers can see demo identities in identity list
- Production users never see demo mode option

### No Production Impact

- Demo code paths only entered via DEMO country selection
- All demo checks use `isDemoMode` flag
- If flag is false, zero overhead
- No changes to real verification logic

---

## Testing Strategy

### Unit Tests

- [ ] Demo data generators produce valid structures
- [ ] Demo proof matches circuit output shape
- [ ] Demo identity stores correctly

### Integration Tests

- [ ] Demo flow completes without errors
- [ ] Demo identity accessible in identity list
- [ ] Real flow unaffected when demo flag is false

### Manual Testing (Pre-Review)

- [ ] Complete demo flow start to finish
- [ ] Verify timing (3-second delays work)
- [ ] Test on multiple devices (screen sizes, orientations)
- [ ] Verify data deletion works in demo mode
- [ ] Verify real mode still works normally

---

## Rollout Strategy

### Phase 1: Internal Testing

- Implement core demo mode
- Test on development builds
- Verify no production code affected

### Phase 2: QA Testing

- Full flow testing on multiple devices
- Edge case testing (network interruption during demo)
- Verify cleanup works correctly

### Phase 3: App Store Submission

- Deploy with demo mode enabled
- Monitor for reviewer feedback
- Be ready to adjust timing/flow if issues arise

---

## Success Criteria

- ✅ Demo mode selectable from country list
- ✅ All steps auto-complete with appropriate timing
- ✅ Face verification uses real biometrics (authentic)
- ✅ Demo identity created and stored successfully
- ✅ Data deletion message shown on completion
- ✅ No production code paths affected
- ✅ Flow completable in <5 minutes
- ✅ Reviewers can verify complete verification functionality

---

## Risks & Mitigations

| Risk                            | Probability | Mitigation                                               |
| ------------------------------- | ----------- | -------------------------------------------------------- |
| Reviewers bypass steps          | Low         | Add validation that all required steps completed         |
| Demo data out of sync           | Medium      | Keep demo structures aligned with real types, unit tests |
| Security review concern         | Low         | Demo clearly labeled, only accessible during selection   |
| Proof doesn't register          | Low         | Demo proof structure matches real, stored locally        |
| Timing issues on slow devices   | Medium      | Use adjustable delay constants, not hardcoded values     |
| Face verification fails in demo | Low         | Use real face capture, only comparison is auto-passed    |

---

## Future Enhancements

- [ ] Add demo mode toggle in Settings (for internal testing)
- [ ] Add demo mode analytics (track reviewer usage)
- [ ] Add pre-recorded face option (if face capture fails)
- [ ] Add demo mode bypass code (for testing)
- [ ] Add configurable delays (for different device speeds)

---

## Related Documentation

- [Verification Flow](./verification-flow.md)
- [Data Security & Cleanup](./data-cleanup.md)
- [Testing Guide](./testing-guide.md)

---

## Implementation Checklist

### Setup

- [ ] Create demo-data.ts with demo constants
- [ ] Create demo-passport-builder.ts with factory functions
- [ ] Create demo-identity-builder.ts with identity creation
- [ ] Add isDemoMode to DocumentScanContext

### Country Selection

- [ ] Add DEMO option to countries list
- [ ] Set isDemoMode flag when DEMO selected

### Document Scanning

- [ ] Add 3-second auto-fill to ScanMrzStep
- [ ] Add 3-second auto-complete to ScanPassportNfcStep

### Face Verification

- [ ] Modify FaceComparisonStep to use live image for both
- [ ] Add auto-pass logic for comparison

### Proof Generation

- [ ] Modify createIdentity to handle demo path
- [ ] Add auto-advance logic to GenerateProofStep

### Testing

- [ ] Unit tests for demo data generators
- [ ] Integration tests for complete flow
- [ ] Manual testing on multiple devices
- [ ] Edge case testing

### Documentation

- [ ] Update README with demo mode info
- [ ] Add demo mode troubleshooting guide
- [ ] Document any configuration needed

---

**Document Version**: 1.0  
**Last Updated**: 2026-06-03  
**Next Review**: After Phase 1 implementation
