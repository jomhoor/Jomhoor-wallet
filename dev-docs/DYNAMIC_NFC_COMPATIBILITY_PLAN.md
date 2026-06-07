# Dynamic NFC Compatibility Plan

## Purpose

Build production NFC readers from evidence gathered with physical passports and
national identity cards. Development probing identifies which NFC technologies,
application protocols, authentication methods, and read parameters work for the
documents currently available for testing. Successfully validated combinations
are then promoted into prioritized production reader strategies.

The goal is not to try every possible NFC command against every tag in
production. The goal is to maintain a controlled compatibility registry of
known-safe strategies, select the most likely strategy at runtime, and preserve
clear failure classifications when no strategy succeeds.

## Scope and flow separation

Passport verification and NID verification remain independent flows:

- They use separate native modules and reader implementations.
- They do not run concurrently.
- They do not need to share an NFC session or native tag object.
- A user can verify with either document type and may verify with the other type
  in a later app session.
- Each flow owns its own probing order, production strategies, authentication,
  data parsing, validation, and error mapping.

Probing may use a separate NFC session for each technology. After probing
finishes, the probe session is closed. A production read may start a new session
using the selected or highest-priority supported strategy.

## Development learning loop

For every available physical document:

1. Record a non-sensitive test label, platform, device model, OS version, and
   document family or generation when known.
2. Run the technology probe while keeping only that document near the device.
3. Record which session detected the tag and which runtime capabilities were
   reported.
4. If ISO-DEP or ISO7816 is available, run only the document-specific protocol
   probes:
   - passport/eMRTD probes for passports;
   - Pardis and MAV4 probes for Iranian NID cards.
5. Record connection success, application-selection result, authentication
   result, read result, validation result, and timing.
6. Repeat the successful path enough times to distinguish a reliable strategy
   from an accidental read.
7. Test the same strategy on both iOS and Android where hardware is available.
8. Add the validated combination to the compatibility registry.
9. Promote it to production only after privacy, safety, negative-case, and
   regression checks pass.

The process is iterative. New document generations remain in development probe
mode until their successful read path is understood and tested.

## Compatibility matrix

Maintain one matrix for passports and one for NID cards. Do not store tag IDs,
document numbers, names, certificate bytes, or other holder data.

Recommended fields:

| Field                  | Description                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `testLabel`            | Non-sensitive local identifier such as `nid-generation-b-sample-1` |
| `documentFlow`         | `passport` or `nid`                                                |
| `documentFamily`       | Known issuer/generation/profile, or `unknown`                      |
| `platform`             | `ios` or `android`                                                 |
| `deviceModel`          | Phone model used for the test                                      |
| `osVersion`            | OS version used for the test                                       |
| `probeTechnology`      | Polling target/session that detected the tag                       |
| `runtimeCapabilities`  | For example `iso14443`, `IsoDep`, `NfcA`, `NfcB`, `NDEF`           |
| `readerStrategy`       | Exact reader/profile attempted                                     |
| `applicationSelection` | Safe result such as `selected`, `not_found`, or `transport_error`  |
| `authentication`       | `BAC`, `PACE`, NID-specific authentication, or `none`              |
| `readResult`           | `success`, `partial`, or a coarse error code                       |
| `validationResult`     | Whether parsed document data passed flow validation                |
| `attemptCount`         | Total repeated attempts                                            |
| `successCount`         | Successful validated reads                                         |
| `medianReadMs`         | Median successful read duration                                    |
| `notes`                | Non-sensitive positioning or compatibility observations            |

The matrix may initially be maintained as a development document or fixture.
Before production strategy selection depends on it, convert stable entries into
typed, reviewed source configuration with tests.

## Technology probing order

The development probe can use one technology per NFC session.

Android:

1. ISO-DEP over NFC-A and NFC-B
2. ISO 14443-A
3. ISO 14443-B
4. NFC Forum/NDEF
5. ISO 15693/NFC-V
6. ISO 18092/FeliCa/NFC-F

iOS:

1. ISO7816 over CoreNFC `iso14443`
2. ISO14443-A/B through the combined CoreNFC `iso14443` polling option
3. NFC Forum/NDEF capability query
4. ISO15693
5. ISO18092/FeliCa

CoreNFC does not expose separate ISO14443-A and ISO14443-B polling options.
They must remain one iOS probe target even though Android can report and poll
them independently.

The order can change when test evidence shows that another technology is more
common or more reliable. Probe order is a development optimization and does not
automatically become the production reader order.

## Reader strategy model

Each flow maintains its own strategy selector and strategy interface.

Conceptual interface:

```text
ReaderStrategy
  id
  supportedPlatforms
  requiredCapabilities
  probe(tag/session)
  read(tag/session, credentials)
  validate(result)
```

Passport strategies may include:

- ICAO eMRTD over ISO7816 with BAC first
- ICAO eMRTD over ISO7816 with PACE first
- Known document-specific transport/read-size variants

NID strategies may include:

- Pardis signing certificate profile
- MAV4 signing certificate profile
- MAV4 authentication certificate profile
- Additional card-generation profiles discovered through development probing

ISO15693, FeliCa, or NDEF detection does not imply that those technologies can
read passport or NID identity data. A production reader strategy is added only
after a complete, validated document read is demonstrated for that technology.

## Production selection

Production selection uses only promoted strategies. It must not execute the
open-ended development probe.

Within each document flow:

1. Start the session required by the highest-priority promoted strategy.
2. Detect and classify the tag using safe native metadata.
3. If capabilities do not match, close the session and try the next promoted
   technology session when the platform permits it.
4. If capabilities match, connect and run a safe application-selection probe.
5. Continue with authentication and reading only after the application is
   recognized.
6. If a known strategy fails with a strategy-eligible error, close the session
   and try the next promoted strategy.
7. Stop immediately for terminal conditions such as user cancellation, NFC
   unavailability, invalid credentials where retry counters may matter, or a
   validation/security failure.

Initial priority should follow observed reliability rather than theoretical
coverage:

```text
priority score =
  validated success rate
  + platform reliability
  + document-family match
  - average read cost
  - fallback risk
```

Do not dynamically download executable APDU profiles. Strategy changes should
ship as reviewed app code or signed, strictly declarative configuration with a
fixed command allowlist.

## Promotion criteria

A development probe result can become a production strategy only when:

- It completes the full required document read, not only tag detection.
- The returned data passes the flow's parsing and cryptographic validation.
- It succeeds repeatedly on the target platform and representative devices.
- Existing supported documents still pass regression testing.
- Wrong-document and unsupported-tag tests fail safely.
- Tag removal and reconnect behavior are understood.
- Commands are read-only and reviewed for card safety.
- Authentication attempts cannot unexpectedly consume card retry counters.
- Production logs and JS results contain no sensitive APDU or holder data.
- Errors map to stable coarse codes.
- Required iOS AIDs and FeliCa system codes are declared at build time.

A suggested initial threshold is at least five successful reads per
document/platform combination with no unexplained failures. This is a starting
policy, not statistical proof; broader hardware testing is required before
claiming general document-generation support.

## Production-safe diagnostics

Development builds may collect:

- polling target;
- detected native tag type;
- capability names;
- connection result;
- operation name;
- status word;
- response length;
- elapsed time;
- selected reader strategy;
- coarse failure stage.

Production builds expose only:

- current user-facing state;
- selected strategy identifier when needed for support;
- coarse error code;
- non-sensitive timing metrics when telemetry is explicitly enabled.

Never log or return:

- tag identifiers;
- document or national ID numbers;
- MRZ credentials;
- names or dates of birth;
- certificate or data-group bytes;
- complete APDU request/response payloads;
- secure-messaging keys or session material.

## Error taxonomy

All strategies should map platform and library errors to:

| Code                       | Meaning                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `NO_TAG_DETECTED`          | The session ended without any tag callback                       |
| `UNSUPPORTED_TAG_TYPE`     | A tag was detected but no promoted strategy supports it          |
| `TAG_DETECTED_NOT_ISO7816` | The document flow expected ISO7816/IsoDep but it was unavailable |
| `CONNECTION_FAILED`        | Native connection to the detected tag failed                     |
| `TAG_LOST`                 | The tag left the RF field after detection                        |
| `APPLICATION_NOT_FOUND`    | Expected application selection failed                            |
| `AUTHENTICATION_FAILED`    | Document access authentication failed                            |
| `SECURE_MESSAGING_FAILED`  | Protected APDU encoding or decoding failed                       |
| `READ_FAILED`              | Required files or data groups could not be read                  |
| `VALIDATION_FAILED`        | Read data failed structural or cryptographic validation          |
| `SESSION_BUSY`             | Another NFC session owns the platform NFC resource               |
| `USER_CANCELLED`           | The user cancelled the operation                                 |
| `UNKNOWN_NFC_ERROR`        | A failure could not be classified safely                         |

Errors must include an internal stage so an application-not-found response is
not confused with a missing file later in the read.

## Entitlements and platform configuration

iOS requires:

- `com.apple.developer.nfc.readersession.formats` containing `TAG`;
- `NDEF` when using NDEF reader functionality;
- `NFCReaderUsageDescription`;
- all supported ISO7816 application AIDs in
  `com.apple.developer.nfc.readersession.iso7816.select-identifiers`;
- supported FeliCa system codes when FeliCa reading is promoted.

The project now requests both `TAG` and `NDEF`. The provisioning profile used to
sign the app must include the corresponding NFC capability. Adding new iOS AIDs
or system codes requires a native build; they cannot be discovered and enabled
remotely at runtime.

Android requires:

- `android.permission.NFC`;
- NFC hardware declaration;
- reader-mode flags appropriate to each probe or production strategy.

## Implementation phases

### Phase 1: Evidence collection

- Keep the development probe flag-guarded.
- Normalize redacted reports from iOS and Android.
- Create passport and NID compatibility matrices.
- Test every currently available physical document repeatedly.
- Identify the exact technology and protocol path for every successful read.

Implementation status: implemented in the app on June 6, 2026.

- Development probe and full-read outcomes are normalized into an allowlisted
  local evidence schema.
- Passport and NID records are stored separately by `documentFlow` and grouped
  into compatibility matrix rows.
- Each development UI accepts a non-sensitive sample label and rejects labels
  containing long numeric identifiers.
- The matrix tracks attempts, successful paths, validated reads, success rate,
  median duration, capabilities, strategy, authentication, and coarse errors.
- Evidence is capped at 250 local records and is available only when `__DEV__`
  is true.
- **Log matrix** prints a redacted JSON export using the
  `[NFC-EVIDENCE][EXPORT]` console prefix.
- **Clear evidence** removes all locally collected compatibility records.
- Android passport evidence currently comes from full reads. The existing
  package-level passport probe remains iOS-only.
- Physical-document repetitions and classification of the resulting matrix
  remain a manual test activity.

### Phase 2: Stable error and capability contracts

- Add shared TypeScript capability, stage, and error types.
- Preserve detailed native failure stages through the JS adapters.
- Stop collapsing unsupported tags, connection failures, and application
  selection failures into timeout or generic read errors.
- Keep passport and NID contracts independent where their protocols differ.

### Phase 3: Strategy extraction

- Extract existing successful paths into named strategies without changing
  their behavior.
- Passport: wrap the current BAC/PACE eMRTD path.
- NID: wrap Pardis and MAV4 profiles separately.
- Add tests for strategy eligibility, fallback decisions, and terminal errors.

### Phase 4: Evidence-based prioritization

- Convert validated compatibility entries into a reviewed strategy registry.
- Order strategies by observed reliability for each platform and document flow.
- Allow fallback only for explicitly eligible errors.
- Use a new NFC session for the next technology when required.

### Phase 5: Additional technology support

- Add ISO15693, FeliCa, NDEF, or new ISO7816 profiles only after a physical
  document has been read and validated through that path.
- Add required iOS AIDs/system codes and perform a native rebuild.
- Repeat compatibility, privacy, and regression testing before promotion.

### Phase 6: Controlled production rollout

- Initially retain the existing known reader as the first strategy.
- Enable additional promoted strategies behind a local build-time feature flag.
- Compare coarse success/failure metrics without collecting document data.
- Remove the flag only after release-build testing on physical iOS and Android
  devices.

## Immediate next actions

1. Collect probe reports for every currently available passport and NID card on
   both platforms.
2. Create the first redacted compatibility matrix from those results.
3. Mark which detected technologies have achieved a full validated read.
4. Keep all other detected technologies diagnostic-only.
5. Extract the current successful passport, Pardis, and MAV4 paths into named
   production strategies.
6. Implement stage-preserving error mapping before adding automatic fallback.

## Decision

Proceed in phases. The dynamic reader should be driven by demonstrated document
compatibility, not broad tag detection alone. Separate sessions and separate
passport/NID modules are acceptable. The production fallback order should be
updated only when physical-document evidence demonstrates that a strategy is
safe, repeatable, and capable of completing the full verification read.
