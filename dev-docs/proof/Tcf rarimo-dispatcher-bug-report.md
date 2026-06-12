# Bug Report: C_RSA_3072_56611 Dispatcher — Wrong keyByteLength

**Date:** March 22, 2026  
**Affected network:** Rarimo L2 Mainnet (chain ID 7368)  
**Contract:** Registration2 at `0x11BB4B14AA6e4b836580F3DBBa741dD89423B971`  
**Dispatcher:** C_RSA_3072_56611 at `0xD05089a1e25b64fE92A199046468042eC5580789`

---

## Summary

The `C_RSA_3072_56611` certificate dispatcher on Rarimo mainnet was deployed with `keyByteLength = 512` instead of the correct value `384`. This causes identity registration to fail for Iranian passports signed by the Ministry of Interior CSCA (which uses RSA exponent 56611).

## The Bug

Iranian passports have two active CSCAs:

| CSCA                             | RSA Key  | Exponent | Dispatcher       | Status     |
| -------------------------------- | -------- | -------- | ---------------- | ---------- |
| Iran Government / IRAN Root CA1  | 4096-bit | 65537    | C_RSA_3072       | **Works**  |
| Ministry of Interior / Police CA | 4096-bit | 56611    | C_RSA_3072_56611 | **Broken** |

Both CSCAs sign Document Signer (DS) certificates that have **3072-bit RSA keys** (384 bytes). The dispatcher name itself reflects this: C_RSA\_**3072**\_56611.

However, the dispatcher was deployed with `keyByteLength = 512` (the value for a 4096-bit key). The likely cause: the migration script confused the **CSCA's** key size (4096-bit → 512 bytes) with the **DS certificate's** key size (3072-bit → 384 bytes).

## What Goes Wrong

During `registerCertificate`, the dispatcher calls `X509.extractPublicKey(cert, keyOffset, keyByteLength)` to extract the DS cert's public key. With `keyByteLength = 512`:

1. The contract reads **512 bytes** starting from the key offset, but the actual modulus is only **384 bytes**
2. The extra 128 bytes are certificate extension data (not key material)
3. `hashPacked()` computes a Poseidon hash over the **last 120 bytes** of this 512-byte blob — which is extension junk, not the RSA modulus
4. This wrong hash gets stored in the CertificatesSMT

Later, the ZK registration circuit independently computes the correct hash from the 384-byte modulus. Since this hash doesn't match what's in the SMT, the Merkle inclusion proof fails and registration is impossible.

## Verification

We confirmed the DS certificate's key size using two independent methods:

- **ASN.1 parsing:** INTEGER length = 385 bytes (with leading 0x00), stripped modulus = **384 bytes = 3072 bits**
- **Node.js crypto (SPKI):** Modulus (n) = **384 bytes = 3072 bits**

The standard dispatcher naming convention confirms the expected value:

| Dispatcher       | Key bits | keyByteLength |
| ---------------- | -------- | ------------- |
| C_RSA_2048       | 2048     | 256 ✓         |
| C_RSA_3072       | 3072     | 384 ✓         |
| C_RSA_4096       | 4096     | 512 ✓         |
| C_RSA_3072_56611 | 3072     | 512 ✗         |

## Fix

Deploy a new `CRSADispatcher` with the correct parameters and register it in Registration2:

```
keyByteLength: 384  (not 512)
keyCheckPrefix: 0x0282018100
exponent: 56611
signer: CRSASHA2Signer (same as current)
```

The existing wrong-hash entry in CertificatesSMT is harmless — it will never be matched by any ZK proof. Once the corrected dispatcher is registered, passports signed by the Ministry of Interior CSCA will register normally.

## Migration Source

The bug originates in `deploy/2_registration.migration.ts`:

```typescript
await deployCRSADispatcher(deployer, 'SHA2', '56611', '512', '0x0282018100')
//                                                    ^^^
//                                              should be "384"
```
