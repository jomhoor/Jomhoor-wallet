# Iranians.Vote Mobile App

The official mobile app for [Iranians.Vote](https://iranians.vote) — a digital democracy platform enabling secure identity verification and voting using NFC document scanning and zero-knowledge proofs on [Rarimo L2](https://rarimo.com/).

**GitHub:** https://github.com/Iranians-Vote-Digital-Democracy/mobile-Iranians.vote

## Demo

[![Watch the MVP Demo](https://transcf.org/wp-content/uploads/2026/03/MVP-Jomhoor-Wallet-thumb.png)](https://transcf.org/wp-content/uploads/2026/03/MVP-Jomhoor-Wallet.mp4)

> **[▶ Watch the MVP Demo](https://transcf.org/wp-content/uploads/2026/03/MVP-Jomhoor-Wallet.mp4)** — Identity verification and voting flow in action.

## Features

- NFC-based passport and national ID card scanning
- Zero-knowledge proof identity verification (Noir + Circom circuits)
- Secure on-chain voting (Rarimo L2 blockchain)
- Privacy-preserving — passport data never leaves the device
- Agora deliberation integration

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

For local Hardhat development, update the `rpcEvm` field to `http://<YOUR_MAC_IP>:8545`.

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
