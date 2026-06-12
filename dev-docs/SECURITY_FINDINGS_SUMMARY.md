# Jomhoor Security Review — Quick Summary

**Date:** May 23, 2026
**Status:** 9 findings identified (5 Critical, 4 High/Medium)
**Target:** Production readiness assessment for Iran deployment

---

## Critical Issues (Fix Immediately)

| #   | Issue                                    | Location                                           | Risk                                                   | Fix Time          |
| --- | ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ | ----------------- |
| 1   | Private key displayed in UI and copyable | `src/pages/app/pages/profile/index.tsx:69–81`      | Physical compromise → fund theft, vote impersonation   | 1–2h              |
| 2   | Extensive logging of crypto secrets      | Multiple locations                                 | Device/telemetry compromise → deanonymization          | 2–3h              |
| 3   | SHA1↔SHA256 signer swap workaround      | `src/api/modules/registration/strategy.ts:131–138` | Protocol mismatch → vote rejection or Sybil acceptance | Depends on Rarimo |

## High-Severity Issues (Fix Before Release)

| #   | Issue                      | Location                                  | Risk                                     | Fix Time |
| --- | -------------------------- | ----------------------------------------- | ---------------------------------------- | -------- |
| 4   | Single relayer endpoint    | `src/api/modules/registration/relayer.ts` | Censorship → registration/voting blocked | 4–6h     |
| 5   | No certificate pinning     | `src/api/client.tsx`                      | MITM → vote/passport interception        | 3–4h     |
| 6   | Single RPC endpoint        | `src/helpers/evm-wallet.ts`               | Service downtime → app unavailable       | 3–4h     |
| 7   | WebView localStorage usage | `src/pages/app/pages/hub/index.tsx`       | XSS/injection → token theft              | 4–6h     |

## Medium Issues (Fix Within 60 Days)

| #   | Issue                               | Location                                     | Risk                       | Fix Time            |
| --- | ----------------------------------- | -------------------------------------------- | -------------------------- | ------------------- |
| 8   | Type confusion in deserialization   | `src/store/modules/identity/Identity.ts:235` | Vote validation bypass     | 1h                  |
| 9   | Weak randomness verification needed | `src/store/modules/wallet.ts:42`             | Private key predictability | 2h audit + TBD impl |

---

## Immediate Action Items (Do Now)

```bash
# 1. Remove private key display
git checkout -b fix/remove-pk-display
# Remove lines 69–81 from src/pages/app/pages/profile/index.tsx
# Commit & PR

# 2. Strip debug logging
# Wrap sensitive console logs with if (__DEV__)
# Remove ICAO, SMT, identity hashes, sk_identity logs

# 3. Create Rarimo coordination issue
# Link SHA1↔SHA256 workaround to Rarimo fix request
# Set 30-day deadline
```

---

## By Release Checklist

- [ ] No private keys in UI
- [ ] No cryptographic secrets in console logs
- [ ] Coordinate Rarimo SHA1/SHA256 fix
- [ ] Multi-relayer support with fallback
- [ ] Certificate pinning on all external APIs
- [ ] Multiple RPC endpoints with health checks
- [ ] WebView data moved to SecureStore
- [ ] Deserialization type checks pass tests
- [ ] Randomness audit complete

---

## Risk to Users (Iran Context)

**Without fixes, a user faces:**

- **Physical compromise**: IRGC agent gains phone → extracts private key in 30 seconds
- **Network compromise**: ISP blocks api.iranians.vote → cannot vote
- **Vote linkage**: Cryptographic material in logs → state correlates vote to IP/device
- **Vote rejection**: Rarimo signer bug fix breaks registration → re-registration required

---

## Full Details

See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for detailed analysis of each finding.
