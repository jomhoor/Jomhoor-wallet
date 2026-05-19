# @iland/passport-verification

Local reusable verification package for Jomhoor.

## Domains

- `passport`: MRZ/access-key utilities, NFC contracts/runtime, passport errors/types.
- `face`: contract-only result/config/error types (no runtime liveness/model code yet).
- `identity-flow`: contract-only flow/result/error/config types.
- `shared`: verification error contract, UI adapter/theme/labels contracts, native status wrapper types.

## Phase 1 status (contract-first)

- Frozen TypeScript contracts for:
  - passport credentials + NFC input/output models
  - shared verification error model
  - face verification result/config models
  - identity-flow result/config/step models
  - shared UI/theme/labels adapter contracts
- No scanner UI migration in this phase.
- No native behavior change in this phase.

## Backends

- `native-ios`: package-owned iOS native backend (CoreNFC + NFCPassportReader)
- `native-android`: reserved, not implemented yet
- `jomhoor-js`: reserved for host-app adapter
- `stub`: no-op backend

## Current exports (selected)

```ts
import {
  parseMrz,
  buildPassportAccessKey,
  readPassportNfc,
  probePassportChip,
  cancelPassportNfcSession,
  getPassportVerificationNativeStatus,
  type PassportCredentials,
  type PassportNfcReadInput,
  type PassportNfcReadResult,
  PassportUtilityError,
  PassportUtilityErrorCode,
  PassportNfcException,
} from '@iland/passport-verification'
```

## Host app ownership (Jomhoor)

- Jomhoor owns navigation, onboarding flow, and post-verification routing.
- Jomhoor owns proof generation, wallet/identity persistence, relayer/backend calls.
- Package does not call Jomhoor stores/proof/relayer directly.
- Package does not persist passport data by default.
- Package accepts host-injected UI/theme/labels adapters.
