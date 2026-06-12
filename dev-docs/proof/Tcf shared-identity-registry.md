# The Shared Identity Registry: Why It Matters

## What Is the FreedomTool Registry?

At the heart of Rarimo's passport verification system sits a single contract called **Registration2**. It is the shared, on-chain registry where every biometric passport in the world can be cryptographically verified and recorded — without revealing the holder's identity.

Registration2 doesn't work alone. It orchestrates a small constellation of contracts:

- **CertificatesSMT** — a Sparse Merkle Tree storing hashes of every Document Signer (DS) certificate that has been registered. Each DS cert signs thousands of passports.
- **RegistrationSMT** — a Sparse Merkle Tree storing identity commitments. One entry per person, derived from a zero-knowledge proof.
- **StateKeeper** — holds the ICAO Master List root (the global trust anchor for passport PKI) and coordinates state across components.
- **Certificate Dispatchers** — small contracts that know how to parse specific certificate formats (RSA 2048, RSA 3072, ECDSA brainpool, etc.) and extract public keys.

When someone scans their passport and registers, the system verifies the entire certificate chain — from the ICAO root, through the country's signing authority (CSCA), down to the document signer — entirely on-chain. The user then generates a ZK proof that their passport is valid, and their identity commitment enters the shared Merkle tree. From that point on, they can prove membership (for voting, authentication, access control) without ever revealing who they are.

## What It Means to Use the Shared Registry

When our app — iranians.vote — uses Rarimo's Registration2, we plug into a **global identity layer**. This has profound implications:

**Shared infrastructure, shared network effects.** Every passport registered through any app — whether it's Rarimo's own FreedomTool, our app, or any future third-party app — ends up in the same Merkle tree. A user who registered through FreedomTool on Android can vote on our proposals. A user who registered through us can participate in any other system built on the same registry. One registration, many use cases.

**No certificate management burden.** The ICAO PKD (Public Key Directory) contains hundreds of country signing certificates, updated periodically through international governance. Rarimo maintains this root on-chain via threshold signature governance (TSS). We don't need to track certificate revocations, additions, or root rotations — it's handled at the protocol level.

**Censorship resistance with a caveat.** Using the shared registry means our app doesn't need permission from Rarimo to read the identity tree or verify proofs. The blockchain is public. But registration itself flows through dispatcher contracts that only Rarimo's governance can update. If a dispatcher has a bug — as we discovered with the Iranian passport case — we cannot fix it ourselves. We depend on the protocol maintainers.

**Privacy by design.** Passport data never leaves the user's device. The phone scans the NFC chip, generates a ZK proof locally, and only the proof (plus the DS certificate for first-time registration) goes on-chain. The shared registry stores cryptographic commitments, not personal data.

## What It Would Mean to Deploy Our Own

Deploying our own Registration2 means standing up an independent copy of the entire identity stack: our own certificate tree, our own identity tree, our own ICAO root, our own dispatchers. This is technically possible — the contracts are open source — but the trade-offs are significant.

**We gain full control.** We can fix dispatcher bugs immediately, add support for new certificate types, update the ICAO root on our own schedule, and manage the entire system without waiting on anyone. For a project focused on a specific population (Iranian voters), this autonomy is appealing.

**We lose the network.** Our identity tree starts empty. Everyone must re-register. A user who already registered through FreedomTool would need to scan their passport again through our app. There is no cross-pollination: identities registered through other apps don't exist in our tree, and our registrations don't exist in theirs. The "register once, use everywhere" promise breaks.

**We take on maintenance.** The ICAO PKD is not static. Countries issue new CSCAs, rotate document signers, and occasionally revoke certificates. Someone needs to monitor these changes and update the on-chain root. Rarimo does this through a decentralized governance process with multiple signers. We would need our own update mechanism — likely a multisig or a trusted admin key, which is less decentralized.

**We duplicate cost.** Every certificate registered in our tree is a separate on-chain transaction, even if the same certificate is already in Rarimo's tree. Every identity registration is a separate proof verification. Gas costs, storage costs, and operational overhead all double.

**The island problem.** In the long run, if every app deploys its own registry, the ecosystem fragments. Instead of one global identity layer, you get dozens of isolated silos. This is the opposite of what decentralized identity is supposed to achieve.

## The Pragmatic Middle Ground

The ideal architecture — and what we currently use — is a hybrid:

- **Identity registration** flows through Rarimo's shared Registration2. One global tree. Shared certificates. Network effects.
- **Voting contracts** are ours. We deploy our own ProposalsState, NoirIDVoting, and proposal management. We have full control over what questions are asked, who can vote (by citizenship, document type, etc.), and how results are tallied.

This gives us sovereignty where it matters (the voting logic) while benefiting from shared infrastructure where duplication would be wasteful (identity verification).

The risk — and we've experienced it firsthand — is that bugs in the shared layer block us, and we can't self-serve a fix. The `C_RSA_3072_56611` dispatcher bug that breaks registration for certain Iranian passports is exactly this scenario: a one-character configuration error in Rarimo's deployment that we can identify but not repair.

This is the fundamental tension of shared infrastructure: you trade autonomy for efficiency. The answer isn't to avoid shared systems — it's to ensure the governance around them is responsive, transparent, and accessible to the builders who depend on them.

For now, we're working with Rarimo to fix the dispatcher. If the process works well, it validates the shared model. If it doesn't, we have the technical capability to go independent. But we'd rather not.
