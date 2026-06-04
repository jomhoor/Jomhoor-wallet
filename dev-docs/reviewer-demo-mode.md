# Reviewer Demo Mode

## Purpose

Jomhoor's main passport verification flow requires a real passport/NFC document. App Review may not have that hardware or document, so the production build includes a local-only reviewer demo path.

The demo path is activated by importing a dedicated review wallet key on first run. The app derives the wallet address from the key and compares only that public derived address against a local allowlist.

## Activation Model

1. Reviewer launches the app for the first time.
2. Reviewer selects `Use existing wallet`.
3. Reviewer pastes the dedicated review private key from App Store Connect review notes.
4. App stores the key exactly like a normal imported wallet key.
5. App derives the wallet address with the same BabyJubjub/Poseidon wallet-address logic used elsewhere in the app.
6. If the derived address is allowlisted, `passportDemoModeEnabled` is true.
7. Passport country selection shows `Demo (No passport required)` as the first option.

Current allowlisted review wallet address:

```text
0x0a6f6d69cff72d0c4ab6faa9e4f55408ea8c4930f8190771d16d01323be5b7fd
```

Do not commit the raw review private key. Keep it in release operations notes or App Store Connect review notes only.

## Safety Invariants

Demo mode must remain harmless even if the review private key leaks.

- Demo mode is local-only.
- Demo mode is clearly labeled in the verification flow, generated profile, proof status, and proposal voting UI.
- The app never compares or hardcodes the raw private key.
- The allowlist contains only derived wallet addresses.
- Demo profile data is stored only in `demoPassportProfileStore`.
- Demo profile data is never written to `identityStore.identities`.
- Demo proof and registration IDs are local fake metadata.
- Demo mode never registers a certificate or identity on-chain.
- Demo mode never submits a real proof.
- Demo mode never submits a real vote.
- Demo proposal votes are tracked only in memory in the demo profile store.
- Logout, live verification start, or losing demo capability clears demo state.

## Rotation

To rotate the review key:

1. Generate a new 32-byte hex private key.
2. Derive its Jomhoor wallet address using the wallet derivation code in `src/store/modules/wallet.ts`.
3. Replace the address in `PASSPORT_DEMO_REVIEW_WALLET_ADDRESSES`.
4. Put the raw private key in App Store Connect review notes.
5. Never put the raw private key in source control.

## Suggested App Review Notes

```text
Jomhoor uses wallet-key based account access, not username/password login.

To review passport verification without a physical NFC passport:
1. Launch the app.
2. Choose "Use existing wallet".
3. Paste this review wallet private key: [insert private key from release operations notes]
4. Continue into the app. Passcode/biometrics can be skipped.
5. Open passport verification.
6. Select "Demo (No passport required)" at the top of the country list.
7. Complete the camera-based face steps normally.

The demo path is clearly labeled, local-only, and does not create a real identity, proof, on-chain registration, or real vote.
```
