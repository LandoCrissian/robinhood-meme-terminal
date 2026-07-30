# RMT immutable creator release review

## Purpose

RMT can prepare a deterministic, private snapshot of one exact creator release candidate before collection or marketplace contracts exist. The snapshot preserves review evidence; it is not RMT approval, legal verification, publication, minting, listing, payment, or permission for contract execution.

Snapshots live below:

`projectAssignments/{projectSlug}/assets/{assetId}/releaseReviews/{reviewId}`

Only the assigned creator and RMT administrator can read them. Browser clients cannot create, update, or delete them. A same-origin, authenticated server endpoint verifies the creator's Firebase identity and project assignment, then creates the snapshot with Firebase Admin in one transaction.

## Bound fields

The deterministic review hash covers:

- the complete normalized asset-and-rights revision;
- project and asset identifiers;
- the saved draft revision hash;
- the assigned creator's Firebase identifier;
- every exact accepted collaborator receipt needed by the revision;
- the exact verified public-IPFS storage receipt and bounded retrieval evidence for the current metadata manifest;
- the proposed payout manifest;
- the complete economics-policy draft and policy hash;
- `simulation_only` economics mode;
- `disabled` contract-execution mode;
- `prepared` status.

Server receipt timestamps are preserved inside the private consent records, but are not used to make an expired response appear timely. Snapshot creation requires already-final accepted receipts.

New snapshots use schema version 3 and require a storage-and-retrieval-verified receipt. Existing schema-version-1 snapshots remain parseable as legacy preparation evidence, and storage-only schema-version-2 snapshots remain parseable without being upgraded in place.

## State boundary

The only snapshot status is:

`prepared`

There is no client-writable `approved`, `published`, `minted`, `listed`, or `executable` transition. Repeating preparation for the exact same candidate is idempotent. Any material change produces a different review hash and a new immutable snapshot.

RMT may attach one separate immutable preparation decision without mutating the snapshot. That decision can mark preparation evidence ready, request changes, or decline the candidate, but it cannot enable contract execution. See `docs/CREATOR_RELEASE_DECISIONS.md`.

The currently attached marketplace economics policy is explicitly a simulation used to validate integrity and UI disclosure. Its hypothetical 2.50% fee is not approved, charged, or promised. No future contract may consume a snapshot whose economics mode is `simulation_only` or whose contract execution mode is `disabled`.

## Security properties

- Creator identity is verified with a revoked-token check.
- The server rechecks project ownership and the current stored asset revision.
- The server requires a provider-verified metadata receipt whose project, asset, revision, metadata hash, and manifest hash match the rebuilt current manifest.
- The receipt proves exact metadata-byte retrieval and bounded retrieval of every referenced media object through a fixed HTTPS IPFS gateway at preparation time.
- Accepted collaborator receipts must match the exact revision, name, role, wallet, and proposed share.
- A creator cannot self-write or alter a snapshot through Firestore.
- The review identifier is the Keccak-256 hash of the normalized payload.
- A modified stored field fails parser and hash validation.
- Snapshot creation does not request a wallet approval or blockchain transaction.

## Required before contracts

1. RMT review workflow with reviewer identity, reason codes, correction handling, and an immutable decision record.
2. Approved production economics policy replacing the simulation policy.
3. Immutable contract-consumable manifest format with chain ID, contract template/version, payment assets, settlement behavior, and policy allowlist.
4. Collaborator-initiated withdrawal and dispute policy before a release freeze.
5. Legal, privacy, and independent security review.
6. Contract invariants, failure simulations, testnet execution, and explicit mainnet authorization.
