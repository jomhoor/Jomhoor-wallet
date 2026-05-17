# @iland/passport-verification

Local reusable verification package for Jomhoor.

## Current scope (safe slice)

- Pure TypeScript passport utilities only:
  - MRZ parsing and validation
  - MRZ sanitization and check-digit helpers
  - passport access-key generation (MRZ key)
  - shared passport types and typed errors

## Current exports

```ts
import {
  parseMrz,
  buildPassportAccessKey,
  type PassportCredentials,
  PassportUtilityError,
  PassportUtilityErrorCode,
} from '@iland/passport-verification/passport'
```

## Not moved yet (intentionally)

- iOS native NFC code
- Android native NFC code
- Expo NFC plugin or Podfile integration
- VisionCamera UI components
- face/liveness/gaze/model assets
- Jomhoor ScanProvider orchestration or identity/proof/wallet logic

## Host app ownership (Jomhoor)

Jomhoor remains owner of navigation, onboarding, NFC flow orchestration, relayer/backend calls, proof generation, and permanent storage.
