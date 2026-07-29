# RMT Creator Asset and Rights Foundation

## Scope

RMT stores private creator drafts for:

- original and AI-assisted artwork;
- music singles, EPs, and albums;
- future NFT collections and editions;
- intended licenses;
- collaborator credits;
- proposed wallet revenue splits.

This foundation deliberately does **not** publish an asset, mint a token, deploy a collection, create a marketplace listing, verify collaborator consent, execute a split, collect a fee, or move funds.

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
- edition model and maximum supply;
- music master-recording and composition-rights confirmations;
- creator-proposed collaborator credits whose consent remains `unverified`;
- optional unique-wallet revenue shares totaling exactly 10,000 basis points.

Firestore enforces the private owner boundary, draft-only state, the unverified collaborator status, and a declared zero-or-10,000-basis-point split total. The draft arrays remain untrusted input. The application validates each name, role, wallet, and share before saving, and any future publishing service or contract builder must independently parse and revalidate every field before preparing an executable transaction.

## State machine

The only permitted state is currently:

`draft`

There is intentionally no client-writable `published`, `approved`, `minted`, `listed`, `accepted`, or `paid` state. Future review, collaborator acceptance, contract deployment, publication, and marketplace execution must be introduced as separate authenticated state transitions.

## Future contract boundary

Marketplace and collection contracts must consume a versioned, reviewed rights snapshot rather than mutable draft fields. Before any contract work:

1. add signed collaborator invitations and acceptance;
2. add an RMT review state with immutable revision hashes;
3. define revocation and correction behavior;
4. define jurisdiction-specific license presentation;
5. map accepted payout wallets into an immutable split manifest;
6. require the creator to review the exact contract configuration and transaction.

Draft data is preparation evidence, not legal advice, copyright registration, an audit, or proof that a third party owns no conflicting rights.
