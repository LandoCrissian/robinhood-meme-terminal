# RMT creator media and metadata manifest

## Purpose

RMT generates one deterministic metadata preview for a valid saved creator-rights revision. This gives creators and reviewers an exact document to inspect before any collection contract, listing, payment, or publication exists.

The manifest begins as local preparation evidence. For a saved revision whose media references are all content-addressed, the assigned creator can ask RMT's authenticated server to pin the exact compact JSON bytes and create a private storage receipt. Neither state is a copyright verification, NFT, listing, approval, or availability guarantee.

## Metadata mapping

- Artwork and NFT collection drafts use primary media as `image`.
- Music releases use primary media as `animation_url` and optional cover artwork as `image`.
- Human-readable attributes disclose asset type, creation method, rights basis, intended license, edition design, and applicable music or AI fields.
- The creator description remains plain text and no HTML is generated.

## Integrity states

Each reference is classified as:

- `content_addressed` when it uses a structurally valid IPFS CID and bounded path; or
- `contains_mutable_reference` when one or more fields use HTTPS.

RMT does not describe HTTPS as permanent. It also does not claim that CID syntax proves pinning, continued gateway availability, ownership, or lawful use.

The manifest contains:

- the exact project, asset, and rights-revision identifiers;
- normalized marketplace metadata;
- a Keccak-256 metadata fingerprint;
- normalized primary and preview media references;
- the aggregate media-integrity state;
- `metadataStorage: not_pinned`;
- `contractExecution: disabled`;
- a Keccak-256 fingerprint of the complete manifest payload.

Changing any covered metadata or rights field changes the rights revision, metadata hash, or manifest hash.

## Trusted storage receipt

The server:

1. verifies a non-revoked Firebase identity and current project assignment;
2. rebuilds the manifest from the saved asset instead of accepting metadata from the browser;
3. rejects HTTPS media references;
4. checks the requested revision, metadata hash, and manifest hash;
5. uploads the exact compact metadata bytes to Pinata's public IPFS network;
6. validates the returned CID, file identifier, and byte length;
7. queries Pinata's public file index by CID and requires the same identifier, CID, and byte length;
8. rechecks the current saved revision after upload;
9. creates an immutable, owner-private Firestore receipt; and
10. binds that receipt into every new schema-v2 release-review hash.

The Pinata calls use the current V3 upload and list endpoints documented in July 2026:

- https://docs.pinata.cloud/api-reference/endpoint/upload-a-file
- https://docs.pinata.cloud/api-reference/endpoint/list-files

No provider call occurs merely by opening or saving a draft. A creator must explicitly choose **Pin exact metadata to IPFS**. The operation consumes only the project's existing Pinata allowance; RMT adds no paid dependency or recurring job here.

## Remaining boundary

Before a release can become executable, RMT still needs bounded retrieval/availability checks for every referenced object, a documented correction/unpin policy, an approved production economics policy, contract-template review, testnet execution, independent security review, and explicit production authorization.
