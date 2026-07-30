# RMT creator media and metadata manifest

## Purpose

RMT generates one deterministic metadata preview for a valid saved creator-rights revision. This gives creators and reviewers an exact document to inspect before any collection contract, listing, payment, or publication exists.

The current manifest is local preparation evidence. It is not an IPFS pin, an availability guarantee, a copyright verification, an NFT, or approval to deploy.

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

## Next trusted transition

Before a release can become executable, RMT still needs:

1. an authenticated server receipt that pins the exact generated metadata bytes;
2. a returned CID parsed and compared with those exact bytes;
3. bounded availability checks for every referenced IPFS object;
4. immutable storage of the pinning and verification receipt;
5. release review that binds that receipt rather than a mutable browser state;
6. cancellation and correction rules before an explicit release freeze.
