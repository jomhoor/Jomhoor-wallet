# Jomhoor Threat Model & Security Architecture

**Purpose:** Guide security decisions and prioritize development efforts  
**Audience:** Core developers, security reviewers, architects  
**Last Updated:** May 23, 2026  

---

## Threat Landscape

### Actors

1. **Iranian State (IRGC, Basij)**
   - Capabilities: Network surveillance, device seizure, ISP control, CA compromise
   - Goals: Suppress voting, deanonymize voters, disrupt voting infrastructure
   - Access: ISP-level (all national traffic), physical device access (checkpoints, arrests)

2. **Malicious Insiders**
   - Capabilities: API/relayer control, smart contract upgrade paths
   - Goals: Sybil attack (add fake voters), vote tampering, fund theft
   - Access: Rarimo contracts (if governance compromised)

3. **Network Adversary (Passive)**
   - Capabilities: Observe traffic patterns, IP correlation
   - Goals: Link votes to identities via timing/volume analysis
   - Access: ISP or VPN endpoint

4. **Device Compromise**
   - Capabilities: Install malware, physical access
   - Goals: Extract private keys, inject malicious votes
   - Access: Family member, colleague, law enforcement

---

## Threats (by Attack Surface)

### A. Identity Verification

**Threat A1: Sybil Attack (Passport Forgery)**
- Attacker creates multiple identities by:
  - Forging passport signatures
  - Registering same real passport multiple times
  - Registering fake passports in Rarimo SMT
- **Impact**: Multiple votes per person, vote inflation
- **Current Defense**: RSA/ECDSA signature validation in circuit, ICAO root inclusion proof
- **Gaps**: Relies on Rarimo dispatcher correctness (SHA1↔SHA256 bug = gap)

**Threat A2: Passport Compromise (Lost/Stolen)**
- Attacker registers legitimate passport, blocks real owner
- **Impact**: Voter disenfranchisement, vote theft
- **Current Defense**: None (no revocation mechanism)
- **Mitigation Needed**: Passport revocation by issuer, identity rotation

**Threat A3: Biometric Spoofing (Liveness Detection)**
- Attacker defeats gaze/liveness challenge with photo, video, deepfake
- **Impact**: Sybil attack using single face + multiple passports
- **Current Defense**: @iland/passport-verification gaze challenge, face comparison
- **Gaps**: Liveness defeat rate unknown; no fallback if gaze fails

---

### B. Voting System

**Threat B1: Vote Tampering (MITM)**
- State/network intercepts vote submission, modifies vote choice
- **Impact**: Vote changed without user knowledge
- **Current Defense**: On-chain verification (vote is immutable once on-chain)
- **Gaps**: No defense during transmission (relayer could modify before submission)

**Threat B2: Vote Linkage (Deanonymization)**
- Attacker links on-chain vote to user identity via:
  - IP address correlation (relayer server logs)
  - Timing analysis (vote submitted → passport registered 1 hour ago)
  - Wallet address reuse (same address for transfers + voting)
  - Cryptographic material in logs
- **Impact**: Targeted arrest, extortion, voter intimidation
- **Current Defense**: ZK proofs (hide identity), wallet unlinking (Secp256k1 separate from BJJ)
- **Gaps**: No certificate pinning (IP exposed), extensive logging, single relayer (IP correlated)

**Threat B3: Double Voting**
- Attacker registers same passport twice, votes twice
- **Impact**: Vote inflation, electoral fraud
- **Current Defense**: SmartKeeper.getPassportInfo() checks activeIdentity
- **Gaps**: Race condition if two registrations submitted simultaneously?

**Threat B4: Proof Reuse/Replay**
- Attacker replays a past voting proof to vote again
- **Impact**: Vote inflation
- **Current Defense**: Implicit (circuit checks current proposal ID, on-chain check prevents replay)
- **Gaps**: Depends on proposal state contract correctness

---

### C. Key Management & Storage

**Threat C1: Private Key Extraction (Device Compromise)**
- Attacker gains physical/software access, extracts BabyJubjub private key
- **Impact**: Vote impersonation, fund theft, identity compromise
- **Current Defense**: SecureStore encryption at rest
- **Gaps**: Key displayed in UI (finding 1), no secure deletion from memory
- **Mitigation Needed**: Remove key display, implement secure memory handling

**Threat C2: Private Key Derivation Weakness**
- Randomness source is not cryptographically secure, attacker predicts key
- **Impact**: Private key compromise, complete account takeover
- **Current Defense**: @iden3/js-crypto randomness (assumed secure)
- **Gaps**: No formal verification; babyJub.F.random() internals unclear

**Threat C3: Backup/Recovery Key Theft**
- If backup mechanism is added, attacker intercepts backup (QR, paper, encrypted export)
- **Impact**: Private key compromise
- **Current Defense**: None (backup not yet implemented)
- **Mitigation Needed**: Encrypted paper wallet, Shamir's secret sharing, or eliminate backup

---

### D. Network & Infrastructure

**Threat D1: Relayer Blocking / Censorship**
- State blocks api.iranians.vote via BGP, DNS, or firewall
- **Impact**: Users cannot register or vote
- **Current Defense**: None
- **Gaps**: Single relayer endpoint, no fallback
- **Mitigation Needed**: Multi-relayer, IPFS, direct on-chain submission

**Threat D2: Relayer Compromise (Malicious Operator)**
- Relayer operator tampers with votes or logs votes for state
- **Impact**: Vote tampering, voter surveillance
- **Current Defense**: None (relayer is trusted)
- **Gaps**: No audit trail, no vote verification from relayer to on-chain
- **Mitigation Needed**: Submit votes directly if relayer untrusted, or use multiple relayers

**Threat D3: RPC Endpoint Downtime**
- Rarimo L2 RPC goes offline (maintenance, DDoS, ISP block)
- **Impact**: App non-functional (cannot vote, check balance, register)
- **Current Defense**: None
- **Gaps**: Single RPC endpoint
- **Mitigation Needed**: Multiple RPC endpoints, local node support

**Threat D4: MITM Attack on API/RPC (Unencrypted or Invalid Cert)**
- State performs MITM on api.iranians.vote or l2.rarimo.com
- **Impact**: Passport data, proofs intercepted; votes modified
- **Current Defense**: HTTPS
- **Gaps**: No certificate pinning (state can forge cert via compromised CA)
- **Mitigation Needed**: Certificate pinning, Tor/VPN integration

---

### E. Data Leakage

**Threat E1: Cryptographic Secrets in Logs**
- ICAO root, SMT proofs, identity hashes logged to device/cloud
- **Impact**: Attacker correlates cryptographic data to votes, enables replay attacks
- **Current Defense**: None
- **Gaps**: 195 console.log statements in codebase, some log sensitive data
- **Mitigation Needed**: Strip logs in production (finding 2)

**Threat E2: WebView XSS Leads to Token Theft**
- JavaScript injected into Agora/Taraaz WebView steals JWT tokens from localStorage
- **Impact**: Attacker impersonates user in deliberation
- **Current Defense**: None explicit
- **Gaps**: localStorage used for Civic Compass state
- **Mitigation Needed**: Move tokens to SecureStore, use postMessage API

**Threat E3: Telemetry / Crash Reporting Leaks PII**
- Sentry, LogRocket, or other telemetry service receives sensitive logs
- **Impact**: State pressure on telemetry service → user data extraction
- **Current Defense**: Unknown (not clear if telemetry is enabled)
- **Gaps**: No explicit telemetry audit
- **Mitigation Needed**: Audit and disable telemetry in production

---

### F. Smart Contracts

**Threat F1: Registration Circuit Verification Failure**
- Malformed proof passes circuit verification due to bug
- **Impact**: Attacker registers without valid passport
- **Current Defense**: Groth16 proof verification on-chain
- **Gaps**: No formal verification of circuits; workaround for Rarimo signer bug
- **Mitigation Needed**: Formal verification, remove workarounds

**Threat F2: Voting Circuit Logic Flaw**
- Voting circuit accepts invalid votes (e.g., allows non-eligible voters)
- **Impact**: Vote inflation or suppression
- **Current Defense**: On-chain verification of ZK proofs
- **Gaps**: Circuits are complex; no formal spec

**Threat F3: Access Control Bypass**
- Admin functions in Registration or StateKeeper can be called by attacker
- **Impact**: Arbitrary registration, state manipulation
- **Current Defense**: Onlyowner patterns (implied)
- **Gaps**: ABI/contract implementation not reviewed in this audit

---

## Defense Layers

### Layer 1: Cryptography (ZK Proofs, Signatures)
- **Status**: Mostly sound, but workaround for Rarimo bug and logging issues
- **Risk**: Medium (correctness unverified, intermediate values logged)

### Layer 2: Device Security
- **Status**: Weak
- **Risk**: High (private key in UI, no secure deletion)

### Layer 3: Network Security
- **Status**: Insufficient
- **Risk**: High (no cert pinning, single relayer, logging)

### Layer 4: Infrastructure Resilience
- **Status**: Weak
- **Risk**: High (single RPC, single relayer, no fallback)

### Layer 5: Operational Security
- **Status**: Unknown
- **Risk**: Unknown (telemetry, logging to external services not audited)

---

## Risk Prioritization

### Critical (Must fix before launch)
1. Private key UI exposure (threat C1) → Finding 1
2. Crypto logging (threat E1) → Finding 2
3. Rarimo signer bug workaround (threat A1) → Finding 3

### High (Must fix before public release)
1. Relayer blocking (threat D1) → Finding 4
2. MITM on API (threat D4) → Finding 5
3. RPC downtime (threat D3) → Finding 6
4. WebView token theft (threat E2) → Finding 7

### Medium (Should fix soon)
1. Deserialization type confusion (threat B1 adjacent) → Finding 8
2. Randomness verification (threat C2) → Finding 9

---

## Mitigations in Development

### For Each Finding

| Finding | Threat | Mitigation Strategy | Effort |
|---------|--------|---------------------|--------|
| 1 | C1 | Remove key display; secure export only | 1–2h |
| 2 | E1 | Strip sensitive logs in production | 2–3h |
| 3 | A1 | Coordinate Rarimo fix; remove workaround | Dep |
| 4 | D1 | Multi-relayer with fallback; IPFS discovery | 4–6h |
| 5 | D4 | Certificate pinning on all endpoints | 3–4h |
| 6 | D3 | Multiple RPC endpoints; user config | 3–4h |
| 7 | E2 | Move to SecureStore; postMessage API | 4–6h |
| 8 | B1 | Fix return types; add deserialization tests | 1h |
| 9 | C2 | Audit randomness; verify crypto-secure | 2h + TBD |

---

## Assumed Security Properties

The design assumes:
1. **Rarimo L2 is honest** (contract upgrades are non-malicious)
2. **Relayer API is honest** (doesn't tamper with votes, no logging)
3. **ZK circuits are correct** (no bugs in Noir/Circom compiler)
4. **Users keep phones physically secure** (device theft is outside threat model)
5. **Network is IPV4/TCP over Iranian ISP** (can be monitored at ISP level)

**Reality check**: Assumptions 1–3 are reasonable. Assumption 4 is violated by findings 1–2. Assumption 5 is the entire threat model.

---

## Future Hardening (Post-Launch)

1. **Identity Revocation**: Allow users to revoke compromised passports
2. **Key Rotation**: Support changing private key without re-registering identity
3. **Voting Audit**: Publish vote commitments off-chain for user verification
4. **Distributed Relaying**: Substrate-based relayer network instead of centralized API
5. **Formal Verification**: Formal proof of circuit correctness
6. **Offline Voting**: Support signing votes offline, broadcasting later
7. **Tor Integration**: Route voting through Tor by default
8. **Blockchain Agnostic**: Support Ethereum, Polygon, or other chains as fallback

---

## Testing Strategy

### Unit Tests
- [ ] Deserialization of all identity types (Finding 8)
- [ ] Randomness passes NIST test suites (Finding 9)
- [ ] Multi-relayer fallback logic

### Integration Tests
- [ ] Vote submission to multiple relayers
- [ ] RPC failover when primary is down
- [ ] Certificate pinning on all TLS connections

### Security Tests
- [ ] No plaintext keys in memory dumps
- [ ] No sensitive data in logs (grep for patterns)
- [ ] WebView isolation (XSS cannot access SecureStore)

### Manual Tests
- [ ] Inspect device logs for cryptographic secrets
- [ ] MITM proxy test (certificate pinning prevents interception)
- [ ] Unplug relayer, verify fallback works

---

## Compliance & Reporting

### Responsible Disclosure
- If exploits are discovered, report to core team privately
- 30-day grace period before public disclosure
- Coordinate with Rarimo/Circom teams for smart contract issues

### Security Audit Cadence
- Every 6 months or after major architecture changes
- Include formal verification of circuits
- Third-party review recommended

---

## Conclusion

Jomhoor's threat model is clear: **resist nation-state surveillance and vote suppression in Iran**. The current architecture addresses identity uniqueness and vote privacy reasonably well via ZK proofs. However, the implementation has gaps in:

- **Device security** (key exposure)
- **Network resilience** (single points of failure)
- **Information leakage** (excessive logging)
- **Censorship resistance** (no fallbacks)

All gaps are fixable within 2–3 weeks of focused development. The priority is the three critical findings (1, 2, 3), followed by the infrastructure hardening (4–7).
