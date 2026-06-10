# WalletKeyService

App-local Expo module that owns the Jomhoor BabyJubjub wallet key.

The JavaScript API exposes public material and fixed cryptographic operations
only. It intentionally has no private-key read, import, export, seed, or
mnemonic API.

This module is additive for now. Existing ZK proof code continues using the
current wallet store until its separate migration is coordinated.

The Secure Enclave and Android Keystore do not implement BabyJubjub or
Poseidon. They protect the key at rest; a fixed native operation decrypts the
key inside this module, performs the operation in the shared Rust core, and
clears the temporary native buffer. Raw key bytes never cross the Expo module
boundary.

## Native storage

- iOS: Keychain, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
- Android: AES-256-GCM wrapping key in Android Keystore, with StrongBox
  preferred when available. The encrypted wallet scalar is kept in
  app-private preferences.

## Crypto compatibility

Both platforms call the same Rust implementation of the iden3 BabyJubjub and
optimized BN254 Poseidon algorithms. Run `yarn wallet-key:build-native` after
changing the Rust core.

Run `yarn wallet-key:test-core` to verify the compatibility vectors without a
device build.
