# Jomhoor Map Feature: Findings and Implementation Plan

- Date: June 10, 2026
- Scope: Add a `Map` destination directly after `Proposals` on the Jomhoor home screen.
- Source projects reviewed:
  - Jomhoor: `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote`
  - iLand mobile: `/Users/shooresh/Documents/hello1/iland24/iland`
  - iLand backend: `/Users/shooresh/Documents/hello1/iland24/back`

## Executive Summary

iLand provides a useful map UI, marker contract, location snapshot model, and
background cache design. It should not be copied directly into Jomhoor.

The main differences are:

1. iLand stores ordinary backend vote rows linked to backend users and identity
   profiles. Jomhoor votes are anonymous ZK-authorized on-chain votes.
2. iLand polls currently have one selected option per vote. Jomhoor proposals
   can contain multiple questions, with one answer per question.
3. iLand stores approximate coordinates in a profile and copies them into each
   vote. Jomhoor should not create a persistent user-location profile linked to
   a wallet or verified identity.
4. iLand's newer marker cache currently publishes buckets with
   `privacy.thresholdK = 1`. This can expose a single geographically isolated
   response and is not acceptable for politically sensitive voting.

Recommended Jomhoor architecture:

- Build the map as an app feature under `src/`, not as a package.
- Add a separate map API module and backend aggregation service.
- Index the existing on-chain `VoteCast` event for proposal answers.
- Attach a coarse location cell to each anonymous vote that participates in the
  map.
- Support `disabled`, `optional`, and `required` location policies per proposal.
- Store a profile-level contribution preference such as `ask`, `share`, or
  `never`. An optional saved home area may contain a coarse cell only, never a
  raw coordinate.
- Keep the coarse cell outside the ZK proof, public signals, voting contract
  calldata, wallet state, and identity state for the first implementation.
- Never send or store raw GPS coordinates, wallet private keys, wallet
  addresses, identity document data, or a backend user ID with a map claim.
- Display only groups of at least five votes, using deterministic parent-cell
  aggregation and public cell centroids.
- Ship the read-only map before enabling location contribution if the secure
  anonymous vote-binding flow is not ready.

## Design Clarification: Location Per Anonymous Vote

A location can be associated with each anonymous vote. The anonymity of the
vote means the map record does not need a wallet address, identity ID, or user
account.

The recommended record is:

```text
anonymous on-chain vote event <-> coarse location cell
```

It should not be:

```text
user profile <-> exact coordinate <-> vote
```

The coarse cell should be stored by the map backend and bound to the finalized
anonymous `VoteCast` event. This preserves the current on-chain vote and ZK
flow while allowing every consenting or location-required vote to contribute
to the map.

Putting a location cell directly into every public on-chain event is different.
Even if the Jomhoor UI later hides groups smaller than five, the unaggregated
per-vote cells would remain permanently visible to anyone querying the chain.
UI aggregation cannot hide raw public blockchain data. Therefore the first
implementation should keep individual coarse cells off-chain and publish only
the thresholded aggregate.

## iLand Findings

### Product Intent

`iland/doc/productSpecification.md` describes the map as a geographic view of
poll results. A user selects a poll and sees the relative size and color of
answers by area.

The current implementation follows that poll-first design:

- The map does not request markers until a poll is selected.
- A poll can be selected inside the map.
- Poll details can open the map with that poll preselected.
- Users can switch between city and country aggregation.
- Users can switch between total-vote and answer-distribution visualization.

Primary mobile files:

- `iland/src/screens/MapScreen.js`
- `iland/src/components/MapComp.js`
- `iland/src/hooks/useVoteMarkers.js`
- `iland/src/services/votingGateway.js`
- `iland/src/utils/mapClustering.js`
- `iland/src/screens/PollDetailsScreen.js`

### iLand Map API

The mobile app calls:

```http
GET /map/markers
  ?pollId=<poll-id>
  &areaLevel=city|country
  &parentAreaId=<optional>
  &countryCode=<optional>
  &includeEmptyAreas=true|false
```

The route requires a backend viewer and returns an array of marker DTOs.

Relevant backend files:

- `back/src/routes/map.ts`
- `back/src/types/contracts.ts`
- `back/src/services/mapMarkerService.ts`

The response shape is effectively:

```ts
type VoteMapMarker = {
  id: string
  pollId: string
  areaId: string
  areaLevel: 'city' | 'country'
  parentAreaId: string | null
  latitude: number
  longitude: number
  totalVotes: number
  optionBreakdown: Array<{
    optionId: string
    label: string
    color: string | null
    count: number
    percentageWithinArea: number
  }>
  leadingOptionId: string | null
  leadingOptionLabel: string | null
  leadingOptionColor: string | null
  leadingOptionCount: number | null
  leadingOptionPercentage: number | null
  mergedAreaCount: number
  privacy: {
    thresholdK: number
    mergeStrategy: 'hierarchical_parent_k'
    mergedFromAreaIds: string[]
    mergedAreaCount: number
    maxMergeDepth: number
  }
  updatedAt: string
}
```

### iLand Location Flow

iLand has two separate location uses.

#### Local map position

`MapComp.js` receives the device coordinate from `react-native-maps`, adds a
random offset of 350 to 2,000 meters, and renders an approximate circle. The
exact coordinate is not intentionally rendered.

The current screen blocks the entire map until location permission is granted,
even though public marker viewing does not technically require location. This
should not be copied. Jomhoor users must be able to view aggregate results
without granting location access.

#### Stored home location and vote snapshot

From Settings, iLand:

1. Requests when-in-use location permission through a custom native module.
2. Performs a one-shot location lookup.
3. Rounds latitude and longitude to two decimal places in JavaScript.
4. Sends them to `PATCH /me/profile/home-location`.
5. Stores them on `identity_profiles`.
6. Copies the rounded profile coordinates into a new vote at vote-submission
   time.

Relevant fields:

```text
identity_profiles.home_country_code
identity_profiles.home_area_id
identity_profiles.home_approx_latitude
identity_profiles.home_approx_longitude
identity_profiles.home_location_source
identity_profiles.home_location_updated_at

votes.vote_latitude_l0
votes.vote_longitude_l0
votes.vote_location_snapshot_at
votes.vote_location_snapshot_version
```

The backend derives a profile area ID from a 0.1-degree coordinate grid when no
explicit area is supplied. Vote coordinates are independently rounded to two
decimal places before insertion.

Important issue: the iLand location utility and Settings flow log coordinate
payloads. Jomhoor must not copy these logs.

### iLand Map Cache

The production-style cache consists of:

- `poll_map_marker_cache`
- `poll_map_refresh_queue`
- snapshot columns on `votes`

Relevant migrations:

- `back/supabase/migrations/20260408113000_add_poll_map_cache_foundation.sql`
- `back/supabase/migrations/20260408183000_add_votes_snapshot_scan_index.sql`

The cache worker:

- Scans valid votes that have snapshot coordinates.
- Groups them into 0.1-degree buckets.
- Stores option counts and a marker coordinate.
- Refreshes after 10 pending votes or 60 seconds by default.
- Checks for work every 10 seconds by default.

### iLand Privacy Gap

iLand contains two different privacy behaviors:

- The legacy/mock aggregation path uses hierarchical merging with `k = 3`.
- The newer single-poll cache path returns `thresholdK = 1`, does not suppress
  single-vote buckets, and uses the arithmetic mean of vote snapshot
  coordinates as the marker coordinate.

The cache path can therefore expose:

- A cell containing only one vote.
- A minority answer count of one inside a larger cell.
- A centroid influenced by a small number of source coordinates.
- Changes over time that allow subtraction attacks.

For Jomhoor, marker coordinates must be fixed cell centroids, and privacy
thresholding must apply to both total cohorts and answer breakdowns.

The intended product rule for Jomhoor is `k = 5`: fewer than five votes in a
cell are moved to the deterministic parent cell. The checked-in iLand backend
does not currently implement that rule consistently, so Jomhoor must implement
and test it explicitly rather than inherit the current constants.

## Current Jomhoor Architecture

### Home and Navigation

Relevant files:

- `src/pages/app/pages/home/index.tsx`
- `src/pages/app/index.tsx`
- `src/route-types.ts`
- `src/routes.tsx`

The home destinations are currently:

1. Profile
2. Proposals
3. Hub
4. Compass

`Map` should be inserted immediately after `Proposals`.

The app stack has no `Map` route today.

### Proposal and Vote Data

Relevant files:

- `src/pages/app/pages/proposals/index.tsx`
- `src/pages/app/pages/poll/index.tsx`
- `src/pages/app/pages/poll/types.ts`
- `src/pages/app/pages/poll/utils.ts`
- `src/utils/circuits/eid-based-query-identity-circuit.ts`
- `abis/ProposalState.json`

Proposals are read from `ProposalsState`. Metadata is loaded from IPFS. A
proposal can contain multiple questions:

```ts
type ProposalMetadata = {
  title: string
  description: string
  imageCid?: string
  acceptedOptions: Array<{
    title: string
    variants: string[]
  }>
}
```

The user submits an array of answers. Each answer is encoded as a one-hot bit
mask (`1 << optionIndex`).

The existing on-chain `VoteCast` event contains:

```solidity
VoteCast(
  uint256 indexed proposalId,
  uint256 indexed userNullifier,
  uint256[] vote
)
```

This is important: a backend indexer can obtain the canonical proposal ID,
anonymous per-proposal nullifier, and answers from the chain. The app does not
need to send answer data again to the map backend.

### ZK-Proof Constraint

The first map implementation must not modify:

- Noir circuit inputs or outputs.
- Rarimo registration behavior.
- Proof generation.
- Public signal ordering.
- `executeINID` calldata.
- `VoteCast` event format.
- Proposal contracts.
- Nullifier derivation.

The current long-key passport workaround and the colleague's ZK work remain
valid because the location cell is metadata in the relayer/map envelope, not a
circuit input or contract field.

Map code must not consume a raw wallet private key. The existing poll flow still
reads the raw key from Zustand and includes it in proof parameters; migration
to `WalletKeyService` is a separate security task. The map implementation must
not add another dependency on that state or modify the circuit files while ZK
work is active.

There are two enforcement levels for a location-required proposal:

1. **Relayer-enforced requirement:** the official app must provide a valid
   coarse cell before the relayer submits the unchanged vote transaction. This
   is compatible with the current proof and is the recommended first version.
2. **Protocol-enforced requirement:** the voting contract and proof bind a
   location claim to the vote. This prevents direct-contract bypass but requires
   coordinated circuit, verifier, contract, and proposal-schema changes. It
   must be a later project and must not be mixed into the current map work.

The first version must document that a relayer-enforced requirement is an
application policy, not a trustless proof of physical presence.

### Native Capability Gap

Jomhoor currently has:

- No `react-native-maps` dependency.
- No `expo-location` dependency.
- An iOS location usage string in `app.config.ts`.
- A generated iOS `Info.plist` with different wording, indicating config drift.
- No Android coarse/fine location permission in the checked-in manifest.

No custom location native module is needed. `react-native-maps` and
`expo-location` should be installed as normal Expo-compatible dependencies and
will be linked by the normal iOS/Android build.

## Recommended Product Behavior

### Map Viewing

- Opening Map must not request location permission.
- A proposal must be selected before marker data is requested.
- For multi-question proposals, the user must select a question.
- The map displays only aggregate, thresholded marker data.
- The map must clearly state that mapped responses can be fewer than total
  on-chain votes because location contribution is optional.
- A proposal details screen can later add `View on map`.

### Location Contribution

- Each proposal has a location policy:
  - `disabled`: no location is requested or attached.
  - `optional`: the vote succeeds whether or not location is contributed.
  - `required`: the official relayer does not submit the vote until a coarse
    location cell is available.
- The user profile stores only a default preference:
  - `ask`: prompt on each location-enabled proposal.
  - `share`: contribute by default, with a per-proposal confirmation or visible
    override.
  - `never`: do not contribute to optional proposals.
- The profile may also store an optional default home area as a coarse cell on
  the device. Saving it must not upload it or link it to an identity.
- Each proposal declares the accepted location source:
  - `current_device_area`: resolve an approximate device location for this
    vote.
  - `saved_home_area`: use the optional coarse home cell stored on the device.
  - `either`: allow the voter to choose.
- A required proposal must show the requirement before the user starts voting.
- A user who denies location on a required proposal cannot submit through the
  official relayer and must receive a clear explanation.
- Request approximate/coarse location where the platform supports it.
- Convert the coordinate immediately to a coarse hierarchical cell.
- Send only the cell ID and policy version with the relay request or anonymous
  map claim.
- Do not send raw latitude/longitude.
- Do not persist raw coordinates in React state, Zustand, MMKV, AsyncStorage,
  route parameters, analytics, logs, or crash reports.
- Persist a coarse home cell only when the user explicitly saves it in the
  profile.
- Clear transient coordinate values after cell derivation.
- For optional proposals, voting must still succeed if permission is denied or
  location lookup fails.
- For required proposals, location acquisition and policy validation happen
  before transaction relay. Proof generation remains unchanged.

Residence must not be inferred from passport nationality. Citizenship and
physical/home location are different data.

Age and nationality can be proven from identity attributes by the existing ZK
policy. Device location is not an identity attribute and is not
cryptographically trustworthy by default. A location-required proposal proves
that the app supplied a platform-reported coarse device location, not that the
voter legally resides there. GPS spoofing and emulator abuse require separate
risk controls if they matter to the poll.

### Unified Proposal Requirements

Proposal requirements should be presented as one policy even though they use
different enforcement mechanisms:

```ts
type ProposalParticipationPolicy = {
  nationality: {
    mode: 'any' | 'identified'
    allowedCountryCodes: string[]
  }
  age: {
    minimumAge: number | null
    maximumAge: number | null
  }
  location: {
    mode: 'disabled' | 'optional' | 'required'
    source: 'current_device_area' | 'saved_home_area' | 'either'
    cellResolution: number
    allowedCellIds: string[]
    policyVersion: number
  }
}
```

Nationality and age belong in the identity ZK policy. Location belongs in the
anonymous relayer/map envelope in v1.

Current-code warning: Jomhoor decodes nationality and birth-date bounds from
`votingWhitelistData`, but the current poll proof code passes `ZERO_DATE_HEX`
for both birth-date bounds. Therefore the map branch must not claim that age
requirements are currently enforced. Wiring proposal age bounds into the proof
belongs to the colleague's ZK work or a separately coordinated change.

## Recommended Backend Design

The Jomhoor repository does not contain the backend implementation needed for
this feature. The map backend should be implemented in the service that can
index `ProposalsState.VoteCast` events and coordinate with the vote relayer.

### Canonical Event Tables

Suggested logical schema:

```text
map_poll_policies
  proposal_id
  location_mode
  location_source
  location_cell_resolution
  privacy_threshold_k
  allowed_cell_ids nullable
  consent_version
  policy_version
  created_at
  updated_at

map_vote_events
  id
  chain_id
  proposal_state_address
  proposal_id
  nullifier_key_hash
  transaction_hash
  log_index
  block_number
  block_hash
  finalized_at
  status

map_vote_answers
  vote_event_id
  question_index
  option_index

map_location_claims
  vote_event_id
  location_cell_id
  location_cell_resolution
  location_source
  policy_version
  consent_version
  claim_receipt_hash
  received_at

map_marker_cache
  proposal_id
  question_index
  location_cell_id
  location_cell_resolution
  total_mapped_votes
  option_counts_json
  privacy_policy_version
  refreshed_at
```

Required constraints:

- `location_mode` is `disabled`, `optional`, or `required`.
- `location_source` is `current_device_area`, `saved_home_area`, or `either`.
- `privacy_threshold_k` is at least 5 in production.
- Unique chain event: chain ID, contract, transaction hash, and log index.
- Unique vote: chain ID, contract, proposal ID, and nullifier key hash.
- At most one location claim per vote event.
- One answer per vote event and question index.
- Validate that each on-chain answer mask contains exactly one supported bit.
- Reject claims for unknown, failed, or non-finalized vote events.

Do not store:

- Wallet private keys or seed material.
- Wallet addresses.
- Backend user IDs.
- Identity IDs or document fields.
- Raw latitude or longitude.
- Device advertising IDs.
- IP addresses beyond short operational security retention.

### Location Cells

Use a hierarchical geographic index such as H3 or an equivalent server-defined
cell system. Store only:

- Cell ID.
- Cell resolution.
- Optional coarse country code.

The server and client must share a versioned cell policy. The marker coordinate
must be the deterministic public centroid of the output cell, never an average
of contributor coordinates.

### Privacy Policy

Required initial policy:

- Use `k = 5` as the minimum published cohort.
- Allow a proposal to configure a higher threshold.
- Apply the threshold to total cell participation.
- Also suppress or merge answer counts below the threshold.
- Move a sparse cell to its deterministic hierarchical parent.
- Repeat parent aggregation until at least five votes exist or no allowed
  parent remains.
- Suppress the result if the highest allowed parent still has fewer than five
  votes.
- Publish in fixed time windows rather than immediately after every vote.
- Do not expose exact last-vote timestamps.
- Prevent clients from comparing multiple resolutions to reconstruct a sparse
  result.
- Return privacy metadata, but not the source child cell IDs.

The cell resolution and publication delay are product and security decisions
and must be configured server-side.

### Binding Location to an Anonymous Vote

A public transaction hash or nullifier alone is not sufficient for submitting
a location claim because another observer could race the real voter.

Recommended flow:

1. The app loads the proposal's map policy before voting.
2. For an optional accepted contribution or a required contribution, the app
   obtains an approximate device coordinate and immediately converts it to the
   configured coarse cell.
3. The app generates the existing ZK proof and calldata without location.
4. The app sends the unchanged calldata to the relayer with a separate
   `mapContext` envelope containing only the cell ID, policy version, and
   consent version.
5. The relayer validates the proposal policy and stores a pending anonymous
   location binding before submitting the transaction.
6. The relayer submits the unchanged transaction.
7. The chain indexer observes the finalized `VoteCast`, obtains the canonical
   proposal ID, nullifier, and answers, and finalizes the pending location
   binding.
8. Failed or replaced transactions cause the pending location binding to
   expire.
9. The map cache publishes only groups that satisfy the parent-aggregation and
   `k = 5` rules.

This is additive. It does not change the proof, contract call, or event.

For optional proposals, a short-lived one-time claim receipt can also support a
post-vote contribution. Required proposals must use the pre-relay flow so a
missing location blocks the official transaction submission.

Until anonymous vote binding exists, location collection should remain
disabled. The read-only map can still be implemented and tested with seeded
aggregate data.

### Suggested API

```http
GET /v1/map/markers
  ?proposalId=<on-chain-id>
  &questionIndex=<zero-based-index>
  &resolution=<allowed-resolution>

GET /v1/map/policies/<proposal-id>
```

The existing relayer request gains a separate optional field:

```json
{
  "data": {
    "attributes": {
      "tx_data": "<unchanged-contract-calldata>",
      "destination": "<unchanged-voting-contract>",
      "map_context": {
        "cell_id": "<coarse-cell-id>",
        "policy_version": 1,
        "consent_version": 1
      }
    }
  }
}
```

`map_context` is backend metadata and must not be inserted into
`tx_data`.

Suggested marker response:

```ts
type MapMarker = {
  id: string
  proposalId: string
  questionIndex: number
  cellId: string
  cellResolution: number
  parentCellId: string | null
  latitude: number
  longitude: number
  totalMappedVotes: number
  optionBreakdown: Array<{
    optionIndex: number
    count: number
    percentage: number
  }>
  privacy: {
    thresholdK: number
    policyVersion: number
    mergedCellCount: number
  }
}
```

Option labels should come from the same proposal metadata already used by the
poll screen. Numeric option indexes are the stable link to the on-chain masks.

## Jomhoor Code Placement

This feature belongs under `src/`, not `packages/`.

`packages/` and `modules/` are appropriate for reusable libraries or native
capabilities such as passport verification and `WalletKeyService`. The map is
Jomhoor application UI and domain integration.

Suggested files:

```text
src/pages/app/pages/map/index.tsx
src/pages/app/pages/map/components/MapMarkerView.tsx
src/pages/app/pages/map/components/MapControls.tsx
src/pages/app/pages/map/utils.ts
src/api/modules/map/index.ts
src/api/modules/map/types.ts
src/hooks/useMapMarkers.ts
src/hooks/useProposalCatalog.ts
```

Existing proposal-loading logic should be extracted from the Proposals screen
into a shared hook/service so Map and Proposals do not implement separate
contract/IPFS parsing behavior.

Expected existing-file changes:

```text
src/pages/app/pages/home/index.tsx
src/pages/app/index.tsx
src/route-types.ts
src/routes.tsx
src/config.ts
env.js
app.config.ts
src/core/localization/locales/en.json
src/core/localization/locales/fa.json
src/core/localization/locales/ar.json
src/core/localization/locales/uk.json
package.json
```

Add `Map` immediately after `Proposals` in `getHomeDestinations()`.

## Implementation Phases

### Phase 1: Contracts and Privacy Rules

- Finalize the marker DTO.
- Finalize the coarse cell system and allowed resolutions.
- Set the production minimum to `k = 5` and define publication delay.
- Define proposal location policies and the relayer `mapContext` envelope.
- Add a threat model for sparse-area and timing attacks.
- Do not change the Jomhoor proof or circuit code.

### Phase 2: Backend Read Path

- Add the `VoteCast` chain indexer.
- Decode and validate multi-question one-hot answer masks.
- Add map tables and migrations.
- Add `disabled`, `optional`, and `required` proposal policies.
- Build hierarchical parent aggregation with `k = 5`.
- Add cache refresh and reorg/finality handling.
- Add relayer-to-map pending vote bindings.
- Add `GET /v1/map/markers`.
- Add `GET /v1/map/policies/:proposalId`.
- Seed test data for UI work.

### Phase 3: Read-Only Jomhoor Map

- Install Expo-compatible `react-native-maps`.
- Add the Map route and home destination under Proposals.
- Extract reusable proposal catalog loading.
- Add proposal and question selectors.
- Render aggregate markers and answer breakdowns.
- Add loading, empty, error, offline, and privacy-explanation states.
- Do not request location permission in this phase.

This phase can proceed without touching the ZK-proof implementation.

### Phase 4: Per-Vote Location Contribution

Begin only after the colleague's ZK branch and vote submission interface are
stable.

- Add the profile preference `ask`, `share`, or `never`.
- Display each proposal's location policy before voting.
- Extend the relayer request with the separate `mapContext` envelope.
- Preserve existing proof inputs, calldata, and contract behavior.
- For optional proposals, request consent without blocking a declined vote.
- For required proposals, obtain the coarse cell before relay.
- Acquire approximate location with `expo-location`.
- Convert it to a coarse cell before networking.
- Finalize the location binding only after the on-chain vote is finalized.
- Treat optional claim failures as non-fatal to voting.
- Block official relay for required proposals when the cell is unavailable.

The integration belongs around the relayer call. Do not refactor proof
generation or add location to circuit parameters as part of Map.

### Phase 5: Hardening

- Add rate limiting and receipt replay protection.
- Add fixed-window cache publication.
- Add reorg reconciliation.
- Add metrics that contain counts only, never cells tied to events or users.
- Validate iOS and Android Release builds on physical devices.
- Perform a dedicated privacy review before enabling production claims.

## Test Plan

### App Tests

- Home displays Map directly after Proposals.
- Pressing Map opens the Map route.
- Opening Map does not request location permission.
- No marker request is made before selecting a proposal and question.
- The app handles multiple questions and option indexes correctly.
- Marker labels join correctly with IPFS proposal metadata.
- Sparse/suppressed data produces a privacy-safe empty state.
- No raw coordinates, private keys, nullifiers, or receipts appear in logs.
- Denied location permission does not affect map viewing or optional-location
  voting.
- Optional location is submitted only after consent.
- Optional location failure never changes a successful vote into a failed
  vote.
- A required-location proposal cannot be relayed without a valid coarse cell.
- No raw coordinate is stored in profile or persisted client state; an
  explicitly saved profile home area contains only a coarse cell.

### Backend Tests

- `VoteCast` events are idempotently indexed.
- Chain reorgs remove or replace non-final events.
- Invalid or multi-bit answer masks are rejected.
- A receipt can be consumed only once.
- A receipt cannot be used for another proposal or event.
- A vote event accepts at most one location claim.
- Disabled proposals reject map context.
- Optional proposals accept votes with or without map context.
- Required proposals reject official relay without valid map context.
- Raw coordinates are rejected by the API schema.
- Cells below five votes move to the deterministic parent or are suppressed.
- Answer counts below five are merged or suppressed.
- Marker coordinates are deterministic cell centroids.
- Public responses contain no nullifier, transaction, wallet, identity, or
  source-cell identifiers.
- Fixed-window publication prevents immediate single-vote differencing.

### Native Validation

- iOS asks for when-in-use location only during optional contribution.
- Android requests coarse location; precise location is not required.
- Map rendering works in Debug and Release.
- RTL controls work in Persian and Arabic.
- Normal `yarn ios` and `yarn android` builds link the dependencies; no separate
  package build is required.

## Acceptance Criteria

The first production-capable Map release is complete when:

- Map appears under Proposals on Home.
- Users can view proposal/question aggregate geography without location access.
- Marker data comes from verified, finalized on-chain vote events.
- Proposal policies support disabled, optional, and required location.
- Each mapped anonymous vote stores only a coarse cell.
- Location is not linked to a wallet address, backend user, or identity record.
- The ZK proof, contract calldata, and voting contracts are unchanged.
- No marker or answer breakdown is published below five votes.
- No raw coordinate or wallet secret is stored or logged.
- The feature passes iOS and Android Release testing.

## Decisions Required Before Coding Location Claims

1. Which backend repository will own the chain indexer and map API?
2. Will the existing relayer own pending anonymous location bindings?
3. What cell resolution and publication delay will be used with `k = 5`?
4. How long should consumed claim records be retained before aggregation-only
   deletion?
5. Is Map public to all app users, or restricted to verified users? Privacy does
   not require viewer identity, so public read access is preferable unless
   product policy says otherwise.
6. Is relayer enforcement sufficient for required-location polls in v1, or
   must a later protocol upgrade make the requirement trustless?
