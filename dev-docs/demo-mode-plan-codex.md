# Passport Verification Demo Mode Plan

## Status

- Planning document only
- Target audience: engineering, QA, and App Review submission owners
- Primary goal: provide a complete reviewer-accessible passport verification path without requiring a physical NFC passport

## Problem

The main passport verification flow requires:

- A readable passport MRZ and barcode
- A physical NFC passport
- A passport portrait for face comparison
- Successful proof generation and registration

Apple App Review may not have access to the required passport or NFC document. If reviewers cannot access the app's main functionality, the submission may be rejected.

The app should provide a visible, clearly labeled demo path that exercises the normal user interface and the real camera-based facial verification steps while avoiding physical passport, cryptographic proof, and on-chain registration requirements.

## Goals

- Add a top-level `Demo (No passport required)` option to passport country selection.
- Start the MRZ and barcode scanner normally, then complete it with fictional demo data after three seconds.
- Show the normal NFC read interface, then complete it with fictional demo data after three seconds without invoking the native NFC reader.
- Keep face liveness, gaze, and live image capture unchanged.
- Run the existing face comparison path using the captured live image as both the document reference and live image.
- Show the normal proof generation progress UI for approximately three seconds.
- Create a clearly labeled demo proof and registration result for the reviewer.
- Keep demo results isolated from real identities, proof consumers, SSO, revocation, and on-chain registration while allowing a clearly labeled local-only Proposals reviewer path.
- Preserve the existing live passport verification behavior.

## Non-Goals

- Generating a valid Noir proof in demo mode
- Registering a certificate or identity on-chain in demo mode
- Adding a fake identity to the real identity store
- Bypassing face liveness or gaze verification
- Hiding demo mode behind a gesture, build flag, or undocumented reviewer action
- Treating demo records as valid credentials outside the reviewer flow

## Product and Security Boundaries

Demo mode must be explicit and visible. Every relevant screen should make it clear that:

> Demo mode uses fictional passport data. No real proof or on-chain registration will occur.

Demo mode must not create a fake `IdentityItem` or write to `identityStore.identities`. The real identity store is consumed by other parts of the application as evidence that the user has a valid credential. Adding a fake identity would create incorrect behavior and could allow demo data to enter security-sensitive flows.

Demo proof and registration records should use a separate type that cannot be mistaken for a real proof:

```ts
type DemoProofRegistrationRecord = {
  kind: 'demo'
  proofId: string
  registrationId: string
  generatedAt: string
}
```

The record may be associated with a public wallet identifier if needed for display, but it must never contain private key material.

## Recommended Architecture

### Explicit Verification Mode

Add an explicit mode to the document scan context and verification session:

```ts
type VerificationMode = 'live' | 'demo'
```

Do not rely on a fake country code as the only demo indicator. Country selection and verification behavior are separate concerns, and an explicit mode is easier to reset, test, and extend.

Recommended state additions:

```ts
type VerificationSession = {
  // Existing fields...
  mode: VerificationMode
}
```

If evidence sources are tracked, add a dedicated demo source:

```ts
type EvidenceSource = 'camera' | 'barcode' | 'nfc' | 'manual' | 'derived' | 'proof' | 'demo'
```

### Demo Fixtures

Create a host-app fixture module:

```text
src/pages/app/pages/document-scan/demo/passport-demo-fixtures.ts
```

It should export:

- A validated fictional ICAO MRZ and barcode result
- A fictional stub `PassportNfcScanOutput`
- A minimal fictional `EPassport` payload for display and state compatibility
- A demo proof and registration record factory
- Shared timing constants

Example exports:

```ts
export const DEMO_SCAN_DELAY_MS = 3000
export const DEMO_PROOF_DELAY_MS = 3000

export const DEMO_PASSPORT_MRZ_BARCODE_RESULT = {
  // Fictional, validated data
}

export const createDemoPassportNfcScanOutput = (): PassportNfcScanOutput => {
  // Fictional stub result
}

export const createDemoProofRegistrationRecord = (
  walletPublicKey?: string,
): DemoProofRegistrationRecord => {
  // Clearly typed demo metadata
}
```

Use fictional ICAO data with an `IRN` nationality, a fictional name, and a document number that cannot be confused with a real user. The IRN nationality allows the reviewer to exercise proposal eligibility. The MRZ fixture must pass the same parsing and validation logic used by the application.

The reusable passport-verification package should remain unchanged unless a later implementation identifies a package-level requirement. App-specific demo behavior belongs in the host scan flow.

### Demo Profile

Create a separate non-persisted demo profile model or store. The demo profile should:

- Be displayed on the Documents screen after the demo flow completes
- Be labeled `Demo profile`
- Be labeled `Not registered on-chain`
- Use a generic user icon or generated identicon rather than persisting the reviewer's captured face
- Be excluded from all real identity selectors and proof consumers
- Participate in proposal eligibility only when no real identity exists
- Record demo votes only in memory without generating or submitting a real vote proof
- Be cleared on app restart, logout, or when a live verification flow begins
- Support an explicit remove action if the Documents UI needs one

The demo profile must not be stored in `identityStore.identities`.

## Detailed Flow

### 1. Country Selection

File:

```text
src/pages/app/pages/document-scan/components/SelectPassportCountryStep.tsx
```

Add `Demo (No passport required)` as the first item in the passport country list.

When selected:

- Set `verificationMode` to `demo`
- Continue to the existing MRZ scan step
- Avoid treating the demo option as a real issuing country

When a real country is selected:

- Set `verificationMode` to `live`
- Preserve the existing country selection behavior

The mode must also be reset during scan cleanup, document type reset, and any navigation path that starts a new live verification.

### 2. MRZ and Barcode Scan

Host wrapper:

```text
src/pages/app/pages/document-scan/components/ScanPassportMrzStep.tsx
```

The existing passport MRZ and barcode camera screen should start normally so the reviewer sees the real scanner UI.

In demo mode:

- Start a one-shot three-second timer when the screen becomes active
- Call the existing successful detection handler with the demo MRZ and barcode fixture
- Prevent duplicate completion if a real scan result is received before the timer fires
- Cancel the timer on unmount, back navigation, retry, or mode change

This keeps the normal transition and state population logic in one place.

### 3. NFC Read

File:

```text
src/pages/app/pages/document-scan/components/ScanPassportNfcStep.tsx
```

NFC must also be bypassed in demo mode. Without this step, the reviewer still needs a physical passport.

The normal NFC instruction screen and `Start NFC Read` button should remain visible.

When the reviewer taps `Start NFC Read` in demo mode:

- Do not call the native NFC reader
- Show the existing waiting or reading UI
- Wait three seconds
- Populate state with `createDemoPassportNfcScanOutput()`
- Continue through the existing successful NFC result path
- Cancel the timer on unmount, back navigation, retry, or mode change

The demo NFC result should identify itself as a stub result where supported, for example:

```ts
backend: 'stub'
finalStatus: 'success'
```

### 4. Passport Details

The existing passport details screen should display the fictional demo data.

Add a visible demo banner so reviewers understand that the details are not read from a real passport.

The demo result should contain enough normalized data for the details and preview screens without requiring real DG parsing or proof inputs.

### 5. Face Liveness, Gaze, and Capture

The current face liveness, gaze challenge, and live image capture flow should remain unchanged.

The reviewer must still:

- Grant camera permission
- Complete the normal face positioning and liveness behavior
- Complete the normal gaze challenge
- Produce a real live capture image

Do not bypass these steps in demo mode.

### 6. Face Comparison

File:

```text
src/pages/app/pages/document-scan/components/FaceComparisonStep.tsx
```

In live mode, preserve the existing passport portrait versus live capture comparison.

In demo mode:

- Use the captured live image URI as the document reference image URI
- Copy the URI into the session-only document portrait variable if required by downstream UI
- Set the biometric reference image URI to the same live capture URI
- Continue running the existing crop and `compareFaces` logic
- Do not hardcode a passing result
- Display a demo label explaining that the live capture is used as the reference image

The captured face image should remain session-only and should not be used as the demo profile image after completion.

### 7. Document Preview

File:

```text
src/pages/app/pages/document-scan/components/DocumentPreviewStep.tsx
```

Update portrait rendering to support:

1. A session portrait file URI
2. The existing base64 passport portrait
3. A generic placeholder when neither exists

This allows the demo flow to preview the session-only reference image and also improves behavior when a live NFC result has no usable portrait.

Add a visible demo label.

### 8. Proof Generation and Registration

Primary orchestration:

```text
src/pages/app/pages/document-scan/ScanProvider/index.tsx
```

Proof UI:

```text
src/pages/app/pages/document-scan/components/GenerateProofStep.tsx
```

At the beginning of `createIdentity`, branch when `verificationMode === 'demo'`.

The demo branch should:

- Navigate to the existing proof generation step
- Progress through the normal proof UI stages over approximately three seconds
- Create a `DemoProofRegistrationRecord`
- Mark the verification session as completed
- Create or update the separate demo profile
- Show final messaging that clearly states no real proof or on-chain registration occurred

The demo branch must not:

- Download or invoke a Noir circuit
- Call a certificate registration strategy
- Call a relayer
- Submit an on-chain transaction
- Create a `NoirZKProof`
- Create a `NoirEpassportIdentity`
- Call `addIdentity`
- Write to `identityStore.identities`

### 9. Documents Screen

Display the completed demo profile separately from real identities.

The card should clearly show:

- `Demo profile`
- Fictional passport holder details
- `Not registered on-chain`
- A generic avatar or identicon

The demo profile must not be returned by selectors used for:

- SSO
- Identity proof generation
- Revocation
- Any authorization decision

The Proposals and Poll screens may read the separate demo profile for a clearly labeled reviewer experience. Demo votes must return before circuit proof generation, relayer calls, or contract submission.

### 10. Proposals and Local Demo Voting

When no real identity exists, the Proposals screen may use the separate demo profile as the active reviewer identity.

The demo proposal path should:

- Use the fictional `IRN` nationality for proposal eligibility
- Display a visible banner that the demo identity is active
- Prefer a real identity whenever one exists
- Allow the reviewer to open proposal details and complete the poll UI
- Record completed demo votes only in the non-persisted demo profile store
- Display a clear message that no proof or on-chain vote was submitted

The demo poll path must return before:

- Query identity circuit creation
- Vote proof generation
- Relayer calls
- Contract submission

## Expected File Changes

Primary files:

```text
src/pages/app/pages/document-scan/ScanProvider/index.tsx
src/pages/app/pages/document-scan/components/SelectPassportCountryStep.tsx
src/pages/app/pages/document-scan/components/ScanPassportMrzStep.tsx
src/pages/app/pages/document-scan/components/ScanPassportNfcStep.tsx
src/pages/app/pages/document-scan/components/FaceComparisonStep.tsx
src/pages/app/pages/document-scan/components/DocumentPreviewStep.tsx
src/pages/app/pages/document-scan/components/GenerateProofStep.tsx
src/pages/app/pages/document-scan/demo/passport-demo-fixtures.ts
src/pages/app/pages/documents/index.tsx
src/pages/app/pages/proposals/index.tsx
src/pages/app/pages/poll/index.tsx
```

Likely additional files:

```text
src/store/modules/demo-passport-profile.ts
src/pages/app/pages/documents/components/DemoPassportProfileCard.tsx
```

Exact store and component locations should follow the existing project organization discovered during implementation.

## Implementation Phases

### Phase 1: State and Fixtures

- Add `VerificationMode`
- Add mode to scan context and verification session
- Add demo evidence source and demo proof metadata types
- Add fictional MRZ, barcode, NFC, and proof fixtures
- Add reset and cleanup behavior

### Phase 2: Passport Input Simulation

- Add the top-level Demo country option
- Add the MRZ and barcode three-second completion path
- Add the NFC three-second completion path
- Add demo labels to passport input and details screens

### Phase 3: Facial Verification Integration

- Keep liveness and gaze unchanged
- Use the live capture as the comparison reference in demo mode
- Preserve the real comparison pipeline
- Improve preview portrait fallback behavior

### Phase 4: Proof and Profile Simulation

- Add the demo branch to `createIdentity`
- Simulate normal proof progress over approximately three seconds
- Create a typed demo proof and registration record
- Add a separate non-persisted demo profile
- Render the demo profile on the Documents screen

### Phase 5: App Review and Release Validation

- Validate the complete flow on an iOS Release or TestFlight build
- Confirm no physical passport or NFC document is required
- Confirm the live passport path remains unchanged
- Add exact reviewer instructions to App Store Connect
- Supply a valid review account if authentication is required

## Test Plan

### Fixture Tests

- Demo MRZ parses successfully
- Demo MRZ check digits and required fields validate
- Demo barcode data is fictional and stable
- Demo NFC output contains all fields required by details and preview screens
- Demo NFC output is marked as a stub result
- Demo proof metadata cannot be mistaken for a real proof type

### State and Mode Tests

- Selecting Demo sets `verificationMode` to `demo`
- Selecting a real country sets `verificationMode` to `live`
- Starting a new live verification clears prior demo state
- Back navigation and scan cleanup clear timers
- Logout and app restart clear the demo profile

### MRZ and NFC Tests

- Demo MRZ completes once after three seconds
- Demo MRZ timer is canceled on unmount
- Demo NFC does not invoke the native NFC reader
- Demo NFC completes once after three seconds
- Demo NFC timer is canceled on unmount
- Live MRZ and NFC behavior remains unchanged

### Face Tests

- Demo mode uses the live capture URI as the reference URI
- The existing crop and `compareFaces` path is still invoked
- Live mode continues using the passport portrait
- Liveness and gaze behavior remains unchanged
- The reviewer's face image is not persisted as the demo profile image

### Proof and Identity Isolation Tests

- Demo mode does not call the certificate registration strategy
- Demo mode does not call the relayer
- Demo mode does not call `addIdentity`
- Demo mode does not write to `identityStore.identities`
- Demo profile is not visible to SSO, revocation, authorization, or real proof selectors
- Proposal eligibility uses the demo profile only when no real identity exists
- Demo voting records a local in-memory result and does not generate or submit a vote proof
- Live proof generation behavior remains unchanged

### Manual Release Validation

- Test on a physical iOS device using a Release or TestFlight build
- Grant camera permission and complete the full demo path without a passport
- Verify MRZ and NFC transitions occur after the expected delays
- Verify back, retry, and repeated taps do not cause duplicate transitions
- Verify the demo profile is clearly labeled
- Verify the live passport path still works with a supported passport
- Verify demo behavior while offline if the demo path is intended to be network-independent

## App Review Instructions

Add the following instructions, adjusted to match the final UI labels, to App Store Connect:

1. Sign in using the supplied App Review test account.
2. Open Documents and start passport verification.
3. Select `Demo (No passport required)` at the top of the country list.
4. The MRZ and barcode camera screen opens normally. Wait approximately three seconds for the fictional demo scan to complete.
5. On the Passport NFC Read screen, tap `Start NFC Read` and wait approximately three seconds. No physical passport or NFC document is required.
6. Review the fictional passport details.
7. Complete the normal face liveness and gaze camera steps.
8. Continue through face comparison. In demo mode, the captured live image is used as both the reference and live image while the normal comparison path runs.
9. Tap Generate Proof and wait approximately three seconds.
10. Confirm that a clearly labeled demo profile is created. No real proof or on-chain registration occurs.
11. Open Proposals and confirm the demo identity is used for eligibility.
12. Open a proposal and complete a demo vote. The vote is recorded locally and is not submitted on-chain.

Camera permission is required. If the app requires authentication, a valid and active review account must also be supplied in App Store Connect.

## Apple Review References

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App Review Information](https://developer.apple.com/help/app-store-connect/reference/app-review-information)

Apple's review guidance allows a fully featured demo mode when reviewers cannot access required hardware or resources. The demo mode does not replace the requirement to provide valid review account credentials when login is required.

## Open Decisions

- Whether the demo profile should exist only until app restart or support a manual remove action
- Whether demo mode should be available in all production builds or only App Review builds
- Whether proof progress should use equal timing per stage or preserve the relative timing of the current UI
- Whether the Documents screen should show a generic avatar or a generated identicon
- Whether the demo path is required to work completely offline

## Acceptance Criteria

- A reviewer can complete passport verification without a physical passport or NFC document.
- The MRZ, NFC, face verification, comparison, proof progress, and final profile screens are all exercised.
- Face liveness and gaze remain real camera-based checks.
- Demo mode is clearly labeled throughout the flow.
- No real proof, identity, certificate registration, relayer request, or on-chain transaction is created.
- Demo data cannot be consumed as a real identity by any application feature.
- A reviewer can exercise proposal eligibility and a local-only demo vote without an on-chain transaction.
- The existing live passport verification path remains unchanged.
