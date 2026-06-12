# NID NFC Native Probe

The NID NFC probe is a development-only diagnostic path for adding support for
new Iranian national identity card generations.

## Guards

The UI and JavaScript API require:

```env
EXPO_PUBLIC_NID_NFC_PROBE=enabled
```

They also require `__DEV__`. The native modules independently require an Android
debug build or the iOS `DEBUG` compilation condition. A release build rejects
the probe regardless of the JavaScript flag.

The flag is enabled in `.env.development`, `.env.local`, and `.env.production`.
The production-service environment is required because local Xcode Debug runs
default to `APP_ENV=production`. This does not expose the probe in a Release
build: JavaScript still requires `__DEV__`, and both native implementations
independently reject non-Debug builds.

## Usage

Open the NID NFC step and select **Run Development NFC Probe**. Keep one card
against the device until the native NFC session completes. If a tag is not found,
the probe advances through platform-specific discovery phases. Each phase gets
up to 20 seconds. A capability mismatch advances immediately rather than waiting
for the remainder of the phase.

Android:

1. NFC Forum tags, verified through Android's NDEF check
2. ISO-DEP / ISO 7816 over ISO 14443-A or B
3. ISO 14443-A
4. ISO 14443-B
5. ISO 15693
6. ISO 18092 / FeliCa

iOS:

1. NFC Forum tags, verified by querying CoreNFC NDEF status
2. ISO-DEP / ISO 7816 over ISO 14443
3. ISO 14443-A/B
4. ISO 15693
5. ISO 18092 / FeliCa

The complete no-tag path takes about 120 seconds on Android and 100 seconds on
iOS, plus the short delays needed to switch native reader sessions.

The normal **Start NFC Read** path also emits redacted native diagnostics in
Debug builds. Standard-read logging does not require the probe environment flag;
the flag controls only the active multi-profile probe.

Android:

```sh
adb logcat -v time -s NidVerificationModule
```

iOS standard reader:

1. Run the app from Xcode on the physical iPhone, or open the iPhone in macOS
   Console.
2. Filter native device logs for `NidNfcIOS`.
3. Filter the separate native probe logs for `NidVerificationModule`.

These are native `NSLog` entries and do not appear in Metro's `(NOBRIDGE)` JavaScript
log stream.

The early standard-reader trace includes:

- CoreNFC availability and requested technology
- polling options and delegate queue
- session creation and `beginSession`
- `tagReaderSessionDidBecomeActive`
- every tag-detection callback and detected tag technology
- ISO 7816 metadata lengths, without identifiers or payload data
- tag matching and `connectToTag` start/result
- polling restarts and full invalidation domain/code

## Probe behavior

Each native polling standard runs in its own session:

| Probe target       | Android reader flags                                   | iOS polling option                                         |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| NFC Forum tags     | `NFC_A`, `NFC_B`, `NFC_F`, `NFC_V`; NDEF check enabled | `iso14443`, `iso15693`, `iso18092`; then query NDEF status |
| ISO-DEP / ISO 7816 | `NFC_A`, `NFC_B`; require `IsoDep`                     | `iso14443`; require `NFCISO7816Tag`                        |
| ISO 14443-A        | `NFC_A`                                                | Combined into CoreNFC `iso14443`                           |
| ISO 14443-B        | `NFC_B`                                                | Combined into CoreNFC `iso14443`                           |
| ISO 15693          | `NFC_V`                                                | `iso15693`                                                 |
| ISO 18092 / FeliCa | `NFC_F`                                                | `iso18092`                                                 |

CoreNFC does not expose separate ISO 14443-A and ISO 14443-B polling options.
The iOS report therefore uses `iso14443-a-b` and includes both names in its
`aliases`. FeliCa is the platform's ISO 18092/NFC-F implementation, so those
names intentionally share one phase on both platforms. NFC Forum tag types are
NDEF-capable tags transported over A, B, F, or V; they are not an additional RF
standard.

The 20-second timer covers tag discovery. It is cancelled as soon as a tag is
detected, so it does not interrupt connection or APDU diagnostics.

The report contains a `standardAttempts` entry for every completed phase,
including `nativePolling`, aliases, and whether the result was a detection,
timeout, capability mismatch, connection failure, or session error. The
successful target is identified in `detectedStandard`.

NID APDU commands require ISO-DEP/ISO 7816. When an ISO 14443 tag exposes that
technology, the probe tries these known profiles without changing the normal
reader:

1. Pardis signing certificate
2. MAV4 signing certificate
3. MAV4 authentication certificate

Each attempt records the operation name, status word, response length, duration,
and whether a four-byte certificate read resembles DER.

## Privacy

The probe does not log or return:

- tag identifiers
- national IDs
- certificate bytes
- raw APDU response data
- cardholder data

Reports can therefore be shared for compatibility investigation, but should
still be handled as development diagnostics.

## Compatibility evidence collection

The NID NFC screen includes a development-only compatibility evidence panel when
the probe is enabled.

1. Enter a non-sensitive label such as `nid-generation-b-sample-1`. Do not use a
   national ID, card number, name, or other holder data.
2. Run the development probe one or more times.
3. Run the normal NFC read so detection evidence can be compared with a complete
   validated read.
4. Repeat the test on each available device/platform.
5. Select **Log matrix** and capture the
   `[NFC-EVIDENCE][EXPORT]` JSON from the console.

The local evidence store contains only allowlisted capability names, strategy
names, status words, coarse errors, timing, and validation outcomes. It does not
store the native probe report, session ID, tag identifier, certificate bytes, or
cardholder fields. The store is limited to 250 records and is disabled outside
`__DEV__` builds.
