# Jomhoor Citizen Wallet

The official mobile app for [Iranians.Vote](https://iranians.vote) — a digital democracy platform enabling secure identity verification and voting using NFC document scanning and zero-knowledge proofs on [Rarimo L2](https://rarimo.com/).

**GitHub:** https://github.com/Iranians-Vote-Digital-Democracy/mobile-Iranians.vote  
**Watch the MVP** [Demo](https://transcf.org/wp-content/uploads/2026/03/MVP-Jomhoor-Wallet.mp4)

## Features

- NFC-based passport and national ID card scanning
- Zero-knowledge proof identity verification (Noir + Circom circuits)
- Secure on-chain voting (Rarimo L2 blockchain)
- Privacy-preserving — passport data never leaves the device
- Agora deliberation integration
- "Sign in with Jomhoor" SSO (wallet-based OAuth2 + PKCE, mandatory app attestation)

## Architecture

Unlike Rarimo's backend-centric FreedomTool, this wallet performs identity work **directly on-device** and only uses the relayer to submit transactions:

```
┌────────────┐    ┌──────────────────┐    ┌──────────────┐
│  Wallet    │───▶│  Relayer         │───▶│  Rarimo L2 / │
│  (device)  │    │  (tx submission) │    │  Hardhat     │
└────────────┘    └──────────────────┘    └──────────────┘
      │                                          ▲
      └────────── Direct RPC reads ──────────────┘
```

The wallet scans the document via NFC, parses the SOD, selects the dispatcher, generates the ZK proof, and builds calldata locally. The relayer is minimal: it signs and broadcasts the transaction with a funded wallet. Passport data never leaves the device.

Trade-off: more decentralized and private, but the wallet must know contract addresses, dispatcher hashes, and certificate parsing rules (see [Local Hardhat Development](#local-hardhat-development)).

## Quick Start

```bash
# 1. Clone (normal git clone hangs on LFS — use this instead)
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/Iranians-Vote-Digital-Democracy/mobile-Iranians.vote.git
cd mobile-Iranians.vote
git lfs pull

# 2. Install
corepack enable        # activates Yarn 4.5.0 via packageManager field
yarn install

# 3. Build & run (iOS — requires physical device)
APP_ENV=production npx expo prebuild --clean
# Open ios/IraniansVote.xcworkspace in Xcode → set your Development Team first!
APP_ENV=production npx expo run:ios --device

# 3. Build & run (Android)
APP_ENV=production npx expo prebuild --clean
APP_ENV=production npx expo run:android --device
```

> **iOS Simulator does NOT work** — the NFC `e-document` module requires a physical device.

See the [Developer Setup Guide](./docs/DEVELOPER_SETUP_GUIDE.md) for the complete walkthrough including troubleshooting.

---

## Prerequisites

| Tool     | Required Version | Install                                                     |
| -------- | ---------------- | ----------------------------------------------------------- |
| Node.js  | >= 20            | `brew install node` or [nvm](https://github.com/nvm-sh/nvm) |
| Yarn     | 4.5.0 (auto)     | `corepack enable` — do NOT install Yarn globally            |
| Git LFS  | latest           | `brew install git-lfs && git lfs install`                   |
| Watchman | latest           | `brew install watchman`                                     |

### iOS

| Tool                    | Notes                                                 |
| ----------------------- | ----------------------------------------------------- |
| Xcode                   | 16+ from Mac App Store, plus `xcode-select --install` |
| CocoaPods               | `sudo gem install cocoapods`                          |
| Apple Developer Account | Required for physical device deployment ($99/year)    |

### Android

| Tool             | Notes                                              |
| ---------------- | -------------------------------------------------- |
| Android Studio   | Latest stable                                      |
| Java 17          | `brew install --cask temurin@17` — **not** Java 21 |
| Android SDK 35   | SDK Manager → SDK Platforms → Android 15           |
| Android NDK 26.1 | SDK Manager → SDK Tools → NDK                      |

> **Java version matters:** Gradle 8.10.2 requires Java 17. If your default is Java 21+, set `JAVA_HOME`:
>
> ```bash
> export JAVA_HOME=$(/usr/libexec/java_home -v 17)
> ```

### For CI/CD and Cloud Builds Only

These are **not** needed for local development:

- **EAS CLI** — `npm install -g eas-cli` (only for `eas build` commands)
- **Expo account** — `eas login` (only for EAS builds)

---

## Cloning

This repo uses **Git LFS** for large binary files (`.aar`, `.xcframework`, `.tflite`). A normal `git clone` will hang trying to download them during filtering.

```bash
# Correct way to clone
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/Iranians-Vote-Digital-Democracy/mobile-Iranians.vote.git
cd mobile-Iranians.vote
git lfs pull          # downloads ~214 MB
```

Verify LFS files downloaded correctly:

```bash
file modules/noir/android/libs/noir.aar
# Expected: "Zip archive data"
# If you see "ASCII text" → LFS pull failed, run git lfs pull again
```

> **SSH may not work** for this GitHub org. Use HTTPS if you get `Permission denied (publickey)`.

### LFS-Tracked Files

Three custom `.aar` files are tracked via LFS (defined in `.gitattributes`):

| File                                                  | Size   | Purpose                     |
| ----------------------------------------------------- | ------ | --------------------------- |
| `modules/noir/android/libs/noir.aar`                  | 7.1 MB | Noir ZK proof generation    |
| `modules/witnesscalculator/android/libs/RmoCalcs.aar` | 4.2 MB | Circuit witness calculation |
| `modules/rapidsnark-wrp/android/libs/rapidsnark.aar`  | 1.0 MB | Groth16 prover              |

**These are custom builds by the Rarimo team** with APIs that differ from public releases. Do NOT replace them with downloads from GitHub releases — they have incompatible method signatures.

---

## Environment

Environment files are **already committed** to the repo — no setup needed:

| File               | Environment | Chain ID | API                 |
| ------------------ | ----------- | -------- | ------------------- |
| `.env.development` | Testnet     | 7369     | staging relayer     |
| `.env.staging`     | Staging     | 7369     | staging relayer     |
| `.env.production`  | Mainnet     | 7368     | `api.iranians.vote` |

The `APP_ENV` variable selects which file to load. It must be set when running any command:

```bash
APP_ENV=production npx expo prebuild --clean
APP_ENV=production npx expo run:ios --device
```

> **Note:** Expo always logs `env: load .env.development .env` regardless of `APP_ENV`. This is Expo's own dotenv loader — our `env.js` correctly reads the `APP_ENV`-specific file.

### Environment Variables

All env vars are validated via Zod in [`env.js`](./env.js). Key variables:

| Variable                                      | Description                                  |
| --------------------------------------------- | -------------------------------------------- |
| `EXPO_PUBLIC_RELAYER_API_URL`                 | Backend relayer URL                          |
| `EXPO_PUBLIC_RMO_CHAIN_ID`                    | Rarimo chain ID (7368 mainnet, 7369 testnet) |
| `EXPO_PUBLIC_REGISTRATION_CONTRACT_ADDRESS`   | Registration2 contract                       |
| `EXPO_PUBLIC_STATE_KEEPER_CONTRACT_ADDRESS`   | StateKeeper contract                         |
| `EXPO_PUBLIC_NOIR_ID_VOTING_CONTRACT`         | NoirIDVoting contract                        |
| `EXPO_PUBLIC_PROPOSAL_STATE_CONTRACT_ADDRESS` | ProposalsState contract                      |

### Adding New Environment Variables

1. Add the `EXPO_PUBLIC_*` key to the appropriate `.env.*` files
2. Add the Zod validation in `env.js` under the `client` or `buildTime` schema
3. Add the mapping in the `_clientEnv` or `_buildTimeEnv` object in `env.js`
4. Rebuild: `APP_ENV=<env> npx expo prebuild --clean`

### Secrets

For sensitive values (not committed), create:

- `.env.secrets.development`
- `.env.secrets.production`

These are gitignored. Use `getSecretWithSuffix()` in `env.js` to access them.

### RPC URLs

Blockchain RPC endpoints are in `src/api/modules/rarimo/constants.ts`:

- Testnet: `https://l2.testnet.rarimo.com`
- Mainnet: `https://l2.rarimo.com`

For local Hardhat development, update the `rpcEvm` field to `http://<YOUR_MAC_IP>:8545`. This is separate from `.env.local` (which only sets the relayer URL).

---

## Local Hardhat Development

For full local development without depending on Rarimo testnet, run the platform's Hardhat node and relayers. From the `platform/` sibling repo:

```bash
# Terminal 1: Hardhat node — keep running
cd platform/services/passport-contracts
npx hardhat node --hostname 0.0.0.0   # 0.0.0.0 so the phone can reach it

# Terminal 2: Deploy passport contracts + mock evidence registry
npx hardhat migrate --network localhost
node scripts/deploy-mock-evidence-registry.js   # required locally

# Terminal 3: Deploy voting contracts
cd ../passport-voting-contracts
npx hardhat migrate --network localhost

# Terminal 4: Docker services (postgres + relayers + nginx)
cd ../../ && docker-compose up -d postgres registration-relayer proof-verification-relayer nginx
```

Then create `jomhoor-wallet/.env.local` with the deployed contract addresses + your Mac's LAN IP, update `rpcEvm` in `src/api/modules/rarimo/constants.ts`, and run:

```bash
APP_ENV=local npx expo run:ios --device
```

> **Common pitfalls:** Don't run Docker's `hardhat-node` alongside CLI Hardhat — they'll fight over port 8545 (symptom: `getProof` returns `0x`). Without `MockEvidenceRegistry`, `registerCertificate` fails with "function call to a non-contract account". If Hardhat's block.timestamp is far behind real time, voting fails with `InvalidDate` — run `node scripts/advance-time.js`.

See the platform repo's copilot-instructions for the full local-dev playbook, including INID voting setup (proposal parameters, relayer funding).

---

## Circuit Detection

The app auto-selects the ZK circuit system based on the scanned document's signing algorithm:

| Document | Signature | Circuit system |
| -------- | --------- | -------------- |
| Iranian passport (modern) | RSA 2048 SHA-256 | Circom (Groth16) |
| Iranian passport Variant A (Type 6) | RSA 2048 SHA-1 E58333 | Circom (Groth16) |
| Iranian passport Variant B | RSA 3072 SHA-1 E33259 | Pending — needs `C_RSA_3072_33259` dispatcher (see platform M6) |
| Iranian National ID (INID) | RSA 2048 | Noir (`registerIdentity_inid_ca`) |
| German passport / ID (TD1) | ECDSA brainpoolP384r1 | Noir |
| Most EU passports | RSA or ECDSA | Auto-detected |

Decision flow: parse SOD → extract DS certificate → read signature algorithm OID → RSA routes to Circom, ECDSA routes to Noir. Specific circuit is chosen by hash algorithm, key size / curve, and document type (TD1 vs TD3).

Key files:

| File | Purpose |
| ---- | ------- |
| `src/utils/circuits/circuit-detector.ts` | Detect RSA vs ECDSA, extract key info |
| `src/api/modules/registration/strategy-factory.ts` | Return strategy for document |
| `src/api/modules/registration/variants/circom-epassport.ts` | Circom/Groth16 passport |
| `src/api/modules/registration/variants/noir-epassport.ts` | Noir/UltraPlonk passport |
| `src/api/modules/registration/variants/noir-eid.ts` | Noir for ID cards (TD1) |

> INID registration and voting are fully working end-to-end. German passport support is WIP — see the platform repo's notes on the cross-curve certificate chain.

---

## Jomhoor SSO

"Sign in with Jomhoor" is a wallet-based OAuth2 (auth-code + PKCE) flow. The wallet authenticates via its BabyJubjub key plus a mandatory App Attest (iOS) / Play Integrity (Android) assertion; relying parties only ever receive a pairwise `sub` — never the wallet address.

Mobile-side surface:

| File | Purpose |
| ---- | ------- |
| `src/hooks/useWalletRegistration.ts` | Wallet generation + `collectAttestation()` + register call |
| `src/hooks/useSsoDeepLink.ts` | Validates `sso.jomhoor.org` host, dedupes nonces |
| `src/pages/auth/components/DeviceNotSupported/index.tsx` | Modal for non-attestable devices (Huawei / rooted / emulator) |
| `src/pages/app/pages/sso-consent/index.tsx` | Consent screen — fetches `/v1/clients/{id}`, calls `/v1/authorize/verify` |
| `modules/appattest/` | Native module producing App Attest / Play Integrity tokens |

The SSO host is hard-coded per `APP_ENV` in `Config.SSO_API_URL` — deep-link query parameters (`api_url`, `apiBaseUrl`) are deliberately ignored. The single trust anchor host is `sso.jomhoor.org`.

App Attest / Play Integrity is a **hard gate** at registration. Non-attestable devices (Huawei without GMS, rooted, emulators, integrity-failing builds) cannot create an account — the `DeviceNotSupported` modal explains why.

### ZK assertions (optional escalation)

For relying parties with `zk_required=true`, the wallet generates a Rarimo `queryIdentity` Groth16 proof (or `queryIdentity_inid_ca` for INID) with `event_id = sso_event_id` and POSTs it to `/v1/assertions/zk` along with a stable `circuit_id` identifying which circuit was used (e.g. `passport_rsa_2048_sha256_e65537`, `passport_rsa_2048_sha1_e58333`, `inid_rsa_2048`). The backend maintains a per-circuit verification-key registry so adding a new document class is a backend config change — the wallet just needs to emit the right `circuit_id`. The backend stores only the nullifier and an expiry; relying parties see only the boolean `zk_verified`, never the document class.

> **Phase 1 — no wallet recovery.** The wallet private key lives only in SecureStore on the device. Re-installing the app or losing the phone produces a fresh BabyJubjub key and therefore a new identity; previous sessions, pairwise subjects, and assertions are not recoverable. ZK-nullifier-based recovery is Phase 2.

**See also:**
- Canonical SSO spec: `docs/SSO/plan.txt` in the platform monorepo
- Backend service, endpoints, and database tables: [platform/README.md](../platform/README.md#sso-sign-in-with-jomhoor)

---

## Building & Running

### iOS

```bash
APP_ENV=production npx expo prebuild --clean
APP_ENV=production npx expo run:ios --device
```

**First time only:** After `prebuild`, you must set your Apple Development Team:

1. Open `ios/IraniansVote.xcworkspace` in Xcode
2. Select **IraniansVote** target → **Signing & Capabilities**
3. Check **Automatically manage signing**
4. Select your **Team**

After that, `expo run:ios --device` will work. See the [Developer Setup Guide](./docs/DEVELOPER_SETUP_GUIDE.md#6-ios-code-signing-critical-for-new-devs) for details.

### Android

```bash
APP_ENV=production npx expo prebuild --clean
APP_ENV=production npx expo run:android --device
```

Make sure `JAVA_HOME` points to Java 17 (not 21).

#### Android Release Signing (after `prebuild --clean`)

`expo prebuild --clean` wipes the `android/` directory and resets the signing config back to debug. To produce a signed AAB for Google Play:

1. Re-create `android/keystore.properties`:
   ```properties
   storeFile=/absolute/path/to/credentials/upload-keystore.jks
   storePassword=<password>
   keyAlias=upload
   keyPassword=<password>
   ```
2. Re-apply the `release` block under `signingConfigs` in `android/app/build.gradle` and point `buildTypes.release` at `signingConfigs.release` (not `signingConfigs.debug`).
3. Bump `versionCode` (integer) for every Google Play upload; `versionName` should match `package.json`.
4. Build: `cd android && ./gradlew bundleRelease` — output at `android/app/build/outputs/bundle/release/app-release.aab`.

The upload keystore and certificate live in `credentials/upload-keystore.jks` and `credentials/upload_certificate.pem`.

### Convenience Scripts

| Script                     | Command                                        |
| -------------------------- | ---------------------------------------------- |
| `yarn prebuild`            | `npx expo prebuild --clean && npx pod-install` |
| `yarn ios`                 | `npx expo run:ios --device`                    |
| `yarn android`             | `npx expo run:android --device`                |
| `yarn start`               | `npx expo start --clear`                       |
| `yarn ios:production`      | `cross-env APP_ENV=production yarn ios`        |
| `yarn android:production`  | `cross-env APP_ENV=production yarn android`    |
| `yarn prebuild:production` | `cross-env APP_ENV=production yarn prebuild`   |

> **Switching environments** requires `prebuild --clean` — native projects must be regenerated.

---

## Project Structure

```
├── abis/                    # Smart contract ABIs (JSON)
├── assets/                  # Fonts, images, certificates, ZK circuits
│   ├── certificates/        # CSCA certificate bundles (PEM)
│   └── circuits/            # ZK circuit files (auth, registration, query)
├── modules/                 # Native Expo modules
│   ├── e-document/          # NFC passport/ID scanning (Swift + Kotlin)
│   ├── noir/                # Noir ZK proof generation
│   ├── rapidsnark-wrp/      # Groth16 prover (Circom circuits)
│   └── witnesscalculator/   # Circuit witness calculation
├── plugins/                 # Expo config plugins
│   ├── withNfc.plugin/      # NFC entitlements
│   └── withLocalAar.plugin.js  # Android AAR file configuration
├── src/
│   ├── api/                 # API clients, React Query, registration/voting logic
│   ├── helpers/             # Contract factories, utility functions
│   ├── pages/               # Screen components (auth/, app/, local-auth/)
│   ├── store/               # Zustand stores (identity, wallet, auth)
│   ├── types/               # TypeScript types + generated contract types
│   ├── ui/                  # Reusable UI components (UiButton, UiCard, etc.)
│   └── utils/               # ZK circuits, document parsing, crypto utilities
├── .env.*                   # Environment configs (committed)
├── app.config.ts            # Expo configuration
└── env.js                   # Env var loading + Zod validation
```

### Key Directories

- **`src/api/modules/registration/`** — Identity registration strategies (Circom vs Noir, passport vs ID card)
- **`src/utils/circuits/`** — ZK circuit builders (registration + voting query proofs)
- **`src/store/modules/identity/`** — Identity state management (scanned documents, ZK proofs)
- **`src/types/contracts/`** — Auto-generated from ABIs — run `yarn generate:ethers-types` to regenerate

---

## Native Modules

| Module              | iOS                           | Android                 | Purpose                     |
| ------------------- | ----------------------------- | ----------------------- | --------------------------- |
| `e-document`        | Swift (NFCPassportReader pod) | Kotlin                  | NFC passport/ID scanning    |
| `noir`              | Swift (NoirSwift.xcframework) | Kotlin + noir.aar       | Noir ZK proof generation    |
| `rapidsnark-wrp`    | Swift                         | Kotlin + rapidsnark.aar | Groth16 proving (Circom)    |
| `witnesscalculator` | Swift                         | Kotlin + RmoCalcs.aar   | Circuit witness calculation |

### E-Document Module

To modify the build configuration, edit `modules/e-document/plugin/src/index.ts`, then compile:

```bash
cd modules/e-document/plugin && npx tsc
```

### File Paths in Native Modules

Expo FileSystem returns URIs with `file://` prefix. Strip it before passing to native modules:

```typescript
const path = asset.localUri.replace('file://', '')
```

---

## Branches

| Branch         | Purpose                                             |
| -------------- | --------------------------------------------------- |
| `main`         | Latest stable release                               |
| `feat/agora`   | Agora deliberation integration (active development) |
| `feat/compass` | Political compass feature                           |
| `feat/wallet`  | Wallet improvements                                 |
| `NID`          | National ID card support                            |

After cloning, switch to the active development branch:

```bash
git checkout feat/agora
git lfs pull
```

---

## Release Process

### Version Bumping

Run the **New App Version** (`release.yml`) workflow in GitHub Actions, or locally:

```bash
yarn release    # uses release-it
```

This increments the version and pushes a tag.

### Building for Distribution

**QA (internal distribution):**

```bash
yarn prebuild:staging && yarn build:staging:ios
yarn prebuild:staging && yarn build:staging:android
```

**Production:**

```bash
yarn prebuild:production && yarn build:production:ios
yarn prebuild:production && yarn build:production:android
```

Add `--local` to build on your machine instead of EAS cloud.

### First EAS Build

The first build must be done locally to generate credentials:

```bash
yarn prebuild:staging && yarn build:staging:ios --local
```

You'll be prompted to sign in to Apple Developer / provide Android keystore info.

### GitHub Actions Setup

Add these secrets to the GitHub repository:

| Secret       | Purpose                                                                             |
| ------------ | ----------------------------------------------------------------------------------- |
| `GH_TOKEN`   | GitHub PAT with `repo` + `workflow` scopes                                          |
| `EXPO_TOKEN` | Expo access token from [expo.dev/settings](https://expo.dev/settings/access-tokens) |

Workflows in `.github/workflows/`:

| Workflow          | File                 | Purpose                     |
| ----------------- | -------------------- | --------------------------- |
| New App Version   | `release.yml`        | Version bump + tag          |
| QA Build          | `eas-build-qa.yml`   | Internal distribution build |
| Production Build  | `eas-build-prod.yml` | Production release build    |
| Lint & Type Check | `lint-ts.yml`        | PR checks                   |

### Secrets for EAS Builds

```bash
yarn prepare-secrets    # pushes .env.secrets.* values to EAS dashboard
```

Then add secret keys to `.github/actions/eas-build/action.yml`. The EAS dashboard provides the values at build time.

---

## Troubleshooting

### Clone hangs at "Filtering content"

```bash
# Cancel and re-clone with LFS deferred
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 <url>
cd <repo> && git lfs pull
```

### "Signing for 'IraniansVote' requires a development team" (iOS)

Open `ios/IraniansVote.xcworkspace` in Xcode → IraniansVote target → Signing & Capabilities → select your Team.

### iOS Simulator doesn't work

Expected — NFC module requires a physical device.

### `xcodebuild` error code 65

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData
rm -rf node_modules android ios .expo
yarn install
npx expo prebuild --clean
npx expo run:ios --device
```

### Android build fails with Java errors

Gradle 8.10.2 requires Java 17:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

### `noir.aar` errors (ClassNotFoundException, method mismatch)

The `.aar` files are custom builds tracked via LFS. Verify they downloaded correctly:

```bash
file modules/noir/android/libs/noir.aar      # Must be "Zip archive data"
wc -c modules/noir/android/libs/noir.aar      # Must be ~7,153,108 bytes
```

If they show as text files, run `git lfs pull`.

### `APP_ENV` not taking effect

Delete generated native projects and rebuild:

```bash
rm -rf ios android
APP_ENV=<env> npx expo prebuild --clean
```

### `Error: spawn ./gradlew EACCES`

```bash
chmod +x android/gradlew
```

### Local-dev runtime errors

| Error | Likely cause | Fix |
| ----- | ------------ | --- |
| `function call to a non-contract account` | `MockEvidenceRegistry` not deployed | `node scripts/deploy-mock-evidence-registry.js` in `passport-contracts` |
| `invalid icao proof` | StateKeeper ICAO root mismatch | Redeploy contracts; persisting? `await sk.changeICAOMasterTreeRoot('0x490355b1…')` |
| `getProof` returns `0x` | Two Hardhat nodes (Docker + CLI) | `docker stop hardhat-node` and use CLI with `--hostname 0.0.0.0` |
| Phone can't reach RPC | Hardhat bound to `localhost` only | Restart with `--hostname 0.0.0.0` |
| Phone reads stale contracts | `rpcEvm` in `constants.ts` points to old IP | Update `src/api/modules/rarimo/constants.ts` |
| `InvalidDate` on voting | Hardhat clock behind real time | `node scripts/advance-time.js` |
| `KeyAlreadyExists` during certificate registration | DS cert already registered by another user | Expected — strategy throws `CertificateAlreadyRegisteredError` and skips to identity registration |
| `PAIRING_FAILED` (`0xd71fd263`) on INID vote | Public-signal mismatch (selector, ZERO_DATE bounds, or missing `INIDUserData` fields) | Verify proposal selector = `65569`, all date bounds = `52983525027888`, 4-field `INIDUserData` |
| `vote overflow` on INID vote | `acceptedOptions` too small | Use `[7]` for 3 options, not `[3]` |
| 403 "Insufficient funds in voting account" | Proposal not funded in relayer DB | `UPDATE voting_contract_accounts SET residual_balance = …` |

### Debugging

- **iOS:** Open Xcode, check build logs
- **Android:** Use Android Studio logcat, or `adb logcat`
- **Metro:** `yarn start` for the dev server with hot reload

---

## Additional Resources

- [Developer Setup Guide](./docs/DEVELOPER_SETUP_GUIDE.md) — Detailed from-scratch setup walkthrough
- [Expo documentation](https://docs.expo.dev/)
- [Rarimo documentation](https://docs.rarimo.com/)
- [React Native docs](https://reactnative.dev/docs/getting-started)
