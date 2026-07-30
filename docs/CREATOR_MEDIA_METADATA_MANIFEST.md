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
8. retrieves the metadata through a fixed HTTPS IPFS gateway and requires byte-for-byte equality;
9. performs a bounded 4 KiB retrieval check for each referenced media object without downloading an unbounded asset;
10. rechecks the current saved revision after upload;
11. creates an immutable, owner-private Firestore receipt; and
12. binds that receipt into every new schema-v3 release-review hash.

The Pinata calls use the current V3 upload and list endpoints documented in July 2026:

- https://docs.pinata.cloud/api-reference/endpoint/upload-a-file
- https://docs.pinata.cloud/api-reference/endpoint/list-files

No provider call occurs merely by opening or saving a draft. A creator must explicitly choose **Pin exact metadata to IPFS**. The operation consumes only the project's existing Pinata allowance; RMT adds no paid dependency or recurring job here.

The retrieval gateway defaults to `https://ipfs.io/ipfs/` and can be replaced with the server-only `CREATOR_IPFS_VERIFICATION_GATEWAY` setting. The configured URL must use HTTPS, contain no credentials, and end in `/ipfs/`. RMT rejects redirects, HTML error bodies, empty bodies, metadata larger than 64 KiB, and metadata whose returned bytes differ. Media responses are sampled and cancelled at 4 KiB even when a gateway ignores the HTTP range request. A successful check proves bounded retrievability at that moment—not permanent availability.

Ongoing provider health and removal requests are governed separately by
[CREATOR_MEDIA_PROVIDER_LIFECYCLE.md](./CREATOR_MEDIA_PROVIDER_LIFECYCLE.md).
The prepared daily monitor cannot rewrite receipts or automatically delete
provider files. An RMT approval records policy intent only; provider execution
remains disabled.

## Correction trail

IPFS content is content-addressed, so RMT never presents a correction as editing or erasing an old CID. Saving a changed creator-rights draft produces a new revision and immediately makes every previous receipt ineligible for new release review. The assigned creator can then record one immutable `mediaReceiptSupersessions/{receiptId}` document that links the replaced revision to the current saved revision. The original receipt remains preserved as history.

An RMT administrator cannot mark an older review preparation-ready after its asset revision changes or its metadata receipt receives a supersession record. A correction does not unpin content, revoke third-party copies, resolve a rights dispute, or make any contract executable.

## Remaining boundary

Before a release can become executable, RMT still needs monitored production
operation of the prepared lifecycle policy, an approved production economics
policy, contract-template review, testnet execution, independent security
review, and explicit production authorization.
