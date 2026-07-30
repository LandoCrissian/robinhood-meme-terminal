# RMT Creator Asset and Rights Foundation

## Scope

RMT stores private creator drafts for:

- original and AI-assisted artwork;
- music singles, EPs, and albums;
- future NFT collections and editions;
- intended licenses;
- collaborator credits;
- proposed wallet revenue splits.

This foundation deliberately does **not** publish an asset, mint a token, deploy a collection, create a marketplace listing, verify underlying ownership claims, execute a split, collect a fee, or move funds.

## Ownership boundary

Drafts live under:

`projectAssignments/{projectSlug}/assets/{assetId}`

Only the verified Firebase profile assigned to that project and the RMT administrator can read them. Only the assigned owner can create, update, or delete a draft. Public users and other signed-in users cannot read the collection.

The assignment must include:

- the `music` module for a music release; or
- the `nft` module for artwork and NFT collection drafts.

## Recorded provenance and rights

Every saved draft records:

- human, AI-assisted, or AI-generated creation method;
- AI tools and a plain-language AI contribution disclosure when AI was used;
- original, commissioned, licensed, or public-domain rights basis;
- a creator rights statement and explicit control confirmation;
- third-party material disclosure and permission confirmation;
- an intended standard or custom license;
- a creator-selected secondary royalty preference from 0% to 10%, presented as a preference rather than guaranteed payment;
- edition model and maximum supply;
- music master-recording and composition-rights confirmations;
- creator-proposed collaborator credits with separate revision-bound wallet consent receipts;
- optional unique-wallet revenue shares totaling exactly 10,000 basis points.
- a deterministic Keccak-256 draft revision hash covering the normalized rights, media, edition, collaborator, and split fields.

For a valid saved revision, the studio also derives a local `rmt_creator_metadata_v1` document and media manifest. Artwork and collection drafts map primary media to `image`; music maps primary media to `animation_url` and optional cover art to `image`. The manifest records each reference as content-addressed IPFS or mutable HTTPS, binds the project, asset, and rights revision, and fingerprints both the metadata and complete manifest. Creators can download the exact JSON for review. This does not upload or pin the metadata, prove gateway availability, verify copyright, or authorize a contract.

The private release passport evaluates ten independent preparation areas: media permanence, creation provenance, rights declarations, license terms, edition design, royalty preference, collaborator consent, revenue splits, revision integrity, and fee disclosure. Its labels are preparation status—not verification, approval, copyright validation, an audit, or a safety guarantee.

ERC-2981 can communicate royalty information to compatible marketplaces, but the standard does not compel a marketplace or buyer to pay it. RMT therefore stores a royalty preference separately from license terms and must disclose actual settlement behavior before a creator signs.

Firestore enforces the private owner boundary, draft-only state, the unverified collaborator status, and a declared zero-or-10,000-basis-point split total. The draft arrays remain untrusted input. The application validates each name, role, wallet, and share before saving, and any future publishing service or contract builder must independently parse and revalidate every field before preparing an executable transaction.

## State machine

The only permitted state is currently:

`draft`

There is intentionally no client-writable `published`, `approved`, `minted`, `listed`, `accepted`, or `paid` state. Future review, collaborator acceptance, contract deployment, publication, and marketplace execution must be introduced as separate authenticated state transitions.

Editing any covered field produces a different revision hash. The hash is a stable fingerprint for future invitations and review, not proof that the creator-supplied statements are true. A future acceptance must bind the collaborator to the exact project, asset, role, wallet, share, revision hash, chain, expiration, and consent terms.

`apps/web/lib/creator-consent.ts` defines that versioned EIP-712 consent envelope and digest. It binds all of those fields, includes a one-time nonce, expires within 30 days, and changes its digest when the revision or proposed share changes. The server records a final response only while the invitation is pending, before expiration, from the invited signer, and against the unchanged asset revision.

Creators can save private, seven-day invitation records and prepare shareable review links. The collaborator review page verifies the packet, current public status marker, exact wallet, chain, expiration, terms hash, and typed signature. A server-only Firebase Admin receipt endpoint atomically records accepted or rejected responses, and the private release passport recognizes only exact accepted receipts. An invited wallet can later sign a separate, invitation-bound withdrawal. The trusted withdrawal endpoint changes both private and public state to `withdrawn`; that receipt immediately stops satisfying release readiness. RMT has no executable release-freeze state yet, so withdrawal remains available for every recorded acceptance in this foundation. Both endpoints remain disabled in any environment without the dedicated server credential. See `docs/CREATOR_COLLABORATOR_CONSENT.md`.

When every blocking passport check is resolved, the assigned creator can prepare a deterministic private release-review snapshot. It binds the complete rights revision, accepted consent manifest, proposed payout manifest, and preparation-only economics policy into an immutable server-created record. The record remains `prepared`, `simulation_only`, and `contract execution disabled`; it is not approval or publication. See `docs/CREATOR_RELEASE_REVIEW.md`.

The private RMT review inbox can add one immutable, reason-coded preparation decision above a snapshot. It can mark evidence preparation-ready, request a new revision, or decline the snapshot. It still cannot enable minting, listing, payment, or contract execution. See `docs/CREATOR_RELEASE_DECISIONS.md`.

## Future contract boundary

Marketplace and collection contracts must consume a versioned, reviewed rights snapshot rather than mutable draft fields. Before any contract work:

1. add an RMT reviewer decision state above the immutable creator-prepared snapshot;
2. define the eventual onchain release-freeze boundary and post-freeze correction process; pre-freeze collaborator withdrawal is implemented;
3. define jurisdiction-specific license presentation;
4. map accepted payout wallets into an immutable split manifest;
5. require the creator to review the exact contract configuration and transaction.

Draft data is preparation evidence, not legal advice, copyright registration, an audit, or proof that a third party owns no conflicting rights.

The research basis and competitive product boundary are recorded in `docs/NFT_CREATOR_PLATFORM_RESEARCH_2026.md`.
