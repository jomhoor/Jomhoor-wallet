# @iland/nid-verification

Reusable Iranian National ID verification flow package for Jomhoor.

Phase 1 scope:

- Front/back step flow with barcode parsing
- Mocked NFC read contract
- Liveness/gaze/face mocked flow using reusable logic from `@iland/passport-verification`
- Proof-input adapter output for host-side proof wiring

## Development NFC probe

The package includes an Android/iOS native probe for identifying unsupported NIDC
chip profiles. It does not replace the normal NFC reader.

The probe is available only when all guards pass:

- JavaScript is running with `__DEV__ === true`
- `EXPO_PUBLIC_NID_NFC_PROBE=enabled`
- Android `BuildConfig.DEBUG` or iOS `DEBUG` is enabled

Production native builds reject the probe even if it is called directly.

The report and native logs contain only:

- NFC technology names
- per-standard detection outcomes and durations
- known profile and APDU operation names
- status words, response lengths, and durations
- redacted native error categories and types

Tag identifiers, certificate contents, national IDs, and raw NFC responses are
not logged or returned.

Android logs:

```sh
adb logcat -v time -s NidVerificationModule
```

On iOS, filter Xcode's native device console for `NidNfcIOS` for standard-reader
session and tag-detection logs. Filter for `NidVerificationModule` for the separate
native probe. Native logs do not appear in Metro's `(NOBRIDGE)` output.

The probe covers NFC Forum/NDEF tags, ISO-DEP/ISO 7816, ISO 14443-A and B,
ISO 15693, and ISO 18092/FeliCa. Each native phase gets up to 20 seconds.
Android polls A and B separately; CoreNFC combines them into one iOS phase.
FeliCa and ISO 18092 share the NFC-F phase. Once a compatible tag is detected,
the discovery timeout is cancelled; ISO-DEP/ISO 7816 APDU profile checks then
run without that discovery deadline.

The app's normal NID NFC reader also forwards redacted scan diagnostics to this
native log channel in Debug builds. This standard logging is independent of the
probe environment flag; Release builds omit it.
