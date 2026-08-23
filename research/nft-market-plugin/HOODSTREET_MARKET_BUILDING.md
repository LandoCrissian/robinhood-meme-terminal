# HoodStreet Market Building — project identity and capability passport

**Working name:** HMB-1  
**Status:** NOVEL RESEARCH CONCEPT / NOT A DEPLOYMENT SPECIFICATION

## Problem

A project can accumulate tokens, NFTs, markets, accounts, agents, claims, vaults, subscriptions, and distributions over time.

A normal profile page cannot prove which contracts belong to the project, which capabilities are live, which markets are external, or what activity actually settled.

A single all-powerful project NFT is also dangerous: transferring it could accidentally move treasury authority, agents, regulated assets, or legal rights.

## Concept

A HoodStreet Market Building is a durable project identity/passport whose visible “floors” are populated by independently verified capability registrations.

```text
HoodStreet Building: StonkBrokers

Ground Floor      Project identity + verified contracts
Market Floor      Token markets + NFT liquidity
Portfolio Floor   ERC-6551 account + contained assets
Agent Floor       Registered agent/MCP capabilities
Claims Floor      Distributions, rewards, refunds, redemptions
Service Floor     Subscriptions and paid APIs
```

The building does not own those protocols. It points to evidence-backed registrations.

## Contract split

Do not deploy one monolith.

### 1. Project Passport

Minimal identity token/record:

- project ID;
- controller;
- manifest hash;
- transfer policy;
- optional renderer;
- controller-migration process;
- emergency revocation/freeze of project claims.

Recommended transfer policy:

- nontransferable; or
- controller-migration-only through an explicit signed process.

Do not make it an unrestricted tradeable NFT. Selling decorative real estate must not automatically transfer project authority.

### 2. Capability Registry

Separate append/revoke registry for capability IDs and evidence roots.

Each capability still uses RMT's independent adapter admission. The passport cannot promote a capability to execution-admitted by itself.

### 3. Evidence/attestation layer

Use/adapt established external primitives where available:

- Ethereum Attestation Service for revocable schema-based evidence;
- ERC-8325-style asset anchors for offchain-asset/legal-evidence bindings;
- verified receipt roots for RMT-originated metrics;
- source manifests for project-controller contract claims;
- ERC-8004 agent identities;
- role/delegation registries.

RMT should not invent a competing attestation stack unless Robinhood Chain lacks a verified deployment and a narrow local registry is objectively required.

### 4. Optional project account

The building may link to—but should not automatically control—a project smart account:

- ERC-6551 TBA;
- Safe with ERC-7579 modules;
- another independently verified account.

Default safe rule:

- building identity has no custody;
- project account is separate;
- regulated-asset custody is not enabled merely because an account exists;
- treasury control is governed separately from presentation identity.

### 5. Role layer

External role systems can provide:

- controller;
- operator;
- market manager;
- distributor;
- agent manager;
- content/announcement manager;
- auditor/attestor.

Hats or ERC-7432-style expiring roles are useful references. Verify exact deployment/semantics before integration.

### 6. Dynamic traits

ERC-7496-like onchain traits or an equivalent evidence renderer can expose:

- verified asset count;
- observed market count;
- verified RMT execution count;
- claimable position count;
- registered agent count;
- capability health;
- evidence observation time/root.

Traits are display evidence. A project cannot self-report volume and have RMT treat it as verified.

## What HMB-1 is not

It is not:

- a share of project or RMT revenue;
- an automatic right to execution fees;
- a stock/RWA wrapper;
- a safety badge;
- a ranking purchase;
- a universal treasury;
- an arbitrary-call wallet;
- project-origin proof without controller evidence;
- execution authority without provider admission.

The tested research type enforces:

- `financialRights: "none"`;
- `safetyEndorsement: false`;
- `paidPlacementMayAffectMarketRanking: false`;
- `regulatedAssetCustodyAllowed: false`.

## Illustrative interfaces

```solidity
interface IHoodStreetProjectPassport {
    event ProjectRegistered(
        bytes32 indexed projectId,
        uint256 indexed tokenId,
        address indexed controller,
        bytes32 manifestHash
    );
    event ControllerMigrationProposed(
        uint256 indexed tokenId,
        address indexed currentController,
        address indexed proposedController
    );
    event ControllerMigrated(
        uint256 indexed tokenId,
        address indexed oldController,
        address indexed newController
    );
    event ManifestUpdated(
        uint256 indexed tokenId,
        bytes32 indexed oldHash,
        bytes32 indexed newHash
    );

    function controllerOf(uint256 tokenId) external view returns (address);
    function projectIdOf(uint256 tokenId) external view returns (bytes32);
    function manifestHashOf(uint256 tokenId) external view returns (bytes32);
}

interface IHoodStreetCapabilityRegistry {
    event CapabilityClaimed(
        bytes32 indexed projectId,
        bytes32 indexed capabilityId,
        bytes32 manifestHash
    );
    event CapabilityRevoked(
        bytes32 indexed projectId,
        bytes32 indexed capabilityId,
        bytes32 reasonHash
    );

    function capabilityManifest(bytes32 projectId, bytes32 capabilityId)
        external
        view
        returns (bytes32 manifestHash, bool active);
}
```

The onchain claim is only one evidence input. RMT separately verifies contracts, runtime, state, and behavior.

## Registration flow

1. Project connects controller wallet.
2. Project signs typed claim: project ID, domains/socials, claimed contracts, nonce/deadline.
3. HoodStreet creates/updates passport record.
4. RMT independently checks contracts and source/deployment evidence.
5. Each capability enters the admission ladder separately.
6. Verified capabilities populate floors.
7. Dynamic traits update only from indexed/attested evidence.
8. Revoked/conflicting evidence degrades/removes capability without deleting history.

## Agent floor

An agent is not merely a URL in metadata.

Future evidence stack:

- ERC-8004 identity or another verified registry;
- MCP/A2A endpoint;
- wallet/account binding;
- capability list;
- validation/reputation evidence;
- narrow mandate/delegation;
- sandboxed/modular account execution;
- expiry and spend/action caps;
- receipt history.

For regulated assets, ERC-8226 is a relevant emerging reference: agent identity, principal compliance, mandate scope/caps, and token compliance remain separate.

## Visual evolution

A building can evolve without financial promises:

- lights on when capabilities are healthy;
- floors appear as adapters become verified;
- ticker shows verified markets;
- Agent Floor shows registered agents;
- Claims Board shows aggregate claim states;
- Distribution marker appears after verified distributions;
- degraded/frozen capabilities visibly close instead of disappearing.

This makes HoodStreet a live map of infrastructure, not a static directory.

## Why it may be novel

Existing primitives separately provide NFT identity, TBAs, modular accounts, roles, attestations, agents, dynamic traits, and asset anchors.

The missing composition is a project-level identity whose primary content is a verified graph of **external executable capabilities**, rendered as a persistent ecosystem location and connected to one terminal.

HMB-1 coordinates those primitives; it does not replace them.

## Development sequence

1. Offchain/read-only manifest and UI fixture.
2. Signed controller claim and independent verification.
3. Capability floors from RMT adapters.
4. Dynamic traits from indexed evidence.
5. Revocation/controller-migration rehearsals.
6. Only then consider a minimal passport/registry contract.
7. Optional account/role/agent integrations remain separate tranches.
