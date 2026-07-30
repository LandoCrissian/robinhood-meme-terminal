# V7 creator editions

Status: source-level module only

Deployment: none

Audit: none

## Purpose

The V7 editions module gives an approved creator release a creator-controlled ERC-1155 contract for limited art editions, music collectibles, game assets, membership items and license-linked records. It is infrastructure for provenance and bounded issuance—not a marketplace, payment contract, copyright registry or legal-rights enforcement system.

One frozen V7 release may deploy one deterministic editions contract through the exact active module version recorded in its immutable module plan.

## Frozen configuration

The release binds:

- collection name and symbol;
- collection metadata URI;
- complete edition-manifest Merkle root;
- maximum number of edition types;
- maximum lifetime minted supply across all edition types;
- ERC-2981 royalty receiver and royalty basis points.

The web builder derives the type count and total lifetime supply from the exact sorted edition list. It then creates the same configuration hash used by the Solidity module. Contract execution remains disabled.

Each manifest leaf binds:

```text
token ID
+ token metadata URI hash
+ edition terms hash
+ lifetime maximum supply for that ID
```

The terms hash may fingerprint a human-readable license or collector-terms document. Recording the hash does not make the terms legally sufficient, prove the creator owns the rights or cause the ERC-1155 token itself to transfer copyright.

## State machine

```text
frozen release intent
    |
    | original creator deploys exact active module + configuration
    v
EDITIONS DEPLOYED
    |
    | original creator presents manifest proof for an unregistered ID
    v
ID REGISTERED: URI + terms + lifetime supply are permanent
    |
    | original creator mints within per-ID and collection-wide caps
    v
PARTIALLY MINTED ---------------------> SOLD OUT
```

Deployment, ID registration and lifetime minted supply never move backward. Transfers do not restore mint capacity. There is no admin mint, supply expansion, URI replacement, terms replacement, burn-and-remint path or module upgrade.

## Contract controls

- only the immutable original creator can mint;
- every mint requires a valid proof from the frozen edition manifest;
- an ID's first mint permanently records its URI, terms hash and supply ceiling;
- later mints for that ID must present the identical configuration;
- lifetime minted supply is capped independently for every ID;
- lifetime total minted supply is capped across the collection;
- registered edition-type count is capped;
- rejected ERC-1155 receiver callbacks roll back registration and supply changes;
- neither the module nor the deployed editions contract accepts native funds;
- the active module address, interface and live code hash must still match the append-only module registry at deployment.

Source limits are 10,000 edition types, 1,000,000,000 lifetime units across a collection, 2,048-byte metadata URIs and a 10% ERC-2981 royalty signal.

## Economics and rights boundary

This module collects no platform fee and has no sale or payout path.

- ERC-2981 is a royalty signal and cannot force a marketplace to pay.
- Creator/collaborator splits remain in the frozen payout-manifest fingerprint and are not executed here.
- V6 launch fees and the current RMT token are unchanged.
- No fee is routed to operations, advertising, holders, projects, buybacks, burns, liquidity or NFT floor purchases.
- Future marketplace settlement must disclose its own fee policy and apply creator splits to net creator proceeds.
- Game functionality, music playback, commercial use, memberships and licenses remain governed by the separately presented content and terms—not by an implied promise from the token standard.

## Web preparation

`apps/web/lib/creator-edition-manifest.ts`:

- rejects empty, duplicate or non-positive token IDs;
- bounds UTF-8 metadata fields and every supply;
- sorts edition IDs deterministically;
- derives URI hashes, double-hashed safe Merkle leaves, root and proof for every edition;
- derives exact type and total-supply caps from the manifest rather than accepting hidden spare capacity;
- validates royalty receiver/rate consistency;
- produces the Solidity-compatible configuration hash;
- exposes no wallet signing, broadcast, deployment or production route.

## Remaining production blockers

1. wire the builder to an authenticated creator review surface;
2. bind each terms hash to a displayed, retrievable and versioned document;
3. connect the source-level human-readable simulations to an authenticated read-only chain verifier;
4. obtain independent smart-contract and specialist rights review;
5. choose canonical chain addresses and verify deployment artifacts;
6. complete a testnet rehearsal with public receipts;
7. add marketplace settlement only after the split and fee contracts are separately proven.
