# V7 live-state verification

Status: source-level read-only verifier

Scope: release freeze, ERC-721 deployment, ERC-1155 deployment and consent-bound split deployment

Signing: disabled

Broadcasting: disabled

Production anchors: none

## Purpose

`creator-v7-live-state-verifier.ts` closes the gap between deterministic review calldata and caller-supplied chain claims. It verifies one prepared V7 release action against one pinned block without changing state.

A successful result is evidence about that exact block. It is not a wallet authorization, audit, safety guarantee, gas estimate, finality guarantee or promise that the transaction will still succeed later.

Every result sets:

- `readOnlyExecution: eth_call_only`;
- `validForSigning: false`;
- `signing: disabled`; and
- `broadcasting: disabled`.

These fields remain disabled even when all checks pass.

## Reviewed anchors

The verifier accepts no default contract address or runtime hash. Its caller must supply separately reviewed anchors for the action being checked:

- chain ID;
- V7 module-registry address and runtime code hash;
- V7 release-registry address and runtime code hash;
- media-evidence-verifier address and runtime code hash for a release freeze;
- every module included in a release freeze;
- the exact collection or split module for a deployment;
- every exact module key, kind, version, interface ID, policy hash and metadata hash.

The version-1 interface IDs are pinned in both TypeScript and Solidity:

- ERC-721 collection: `0x6c2ba9ae`;
- ERC-1155 editions: `0xb96f46b7`; and
- consent-bound split: `0xe161dd4b`.

Core, verifier and module addresses must be distinct and every address, bytes4 value and bytes32 fingerprint must be nonzero and well formed.

No production anchors are defined in this increment.

## Pinned verification sequence

The verifier stops at the first failed requirement and returns a deterministic failed receipt. It:

1. recomputes the simulation fingerprint and rejects an altered explanation or calldata;
2. verifies the connected chain against both the reviewed anchor and simulation;
3. pins the latest block number, hash and timestamp;
4. reads every contract at that exact block;
5. hashes every required registry, evidence verifier and module runtime and compares it to its reviewed anchor;
6. verifies every release registry and module points to the reviewed topology;
7. reads each append-only module record and verifies:
   - action-specific kind and version;
   - implementation address;
   - interface ID;
   - implementation runtime hash;
   - policy hash;
   - metadata hash;
   - active state;
   - zero deactivation timestamp;
   - kind/version lookup; and
   - locally recomputed module key;
8. decodes the exact calldata and recomputes the relevant configuration or module manifest;
9. verifies the action-specific release state and exact creator;
10. verifies every exact frozen module intent for deployments;
11. verifies current signer epoch, evidence lifetime and signature for a freeze;
12. verifies that no collection or split is already recorded for a deployment;
13. executes the exact calldata from the creator through `eth_call` at the pinned block; and
14. rereads the pinned block and rejects a changed hash.

For a freeze, the read-only call exercises the current media evidence, module admission and irreversible manifest path. For a collection, it exercises the frozen intent and deterministic deployment path. For a split, it additionally exercises every EOA or ERC-1271 recipient consent, the current deadline and payout manifest. Returned addresses or manifest hashes are recorded as evidence, but no state is persisted.

## Failure behavior

RPC errors, absent code, malformed receipts, runtime drift, registry drift, inactive modules, altered policy, wrong creators, wrong release state, changed manifests, stale evidence, expired consent, prior deployment, invalid signatures, call reverts and immediate block replacement all fail closed.

The result includes:

- simulation ID;
- verification ID;
- pinned block context when available;
- every completed check;
- the first failed check;
- a sanitized failure reason; and
- immutable execution-disabled fields.

The verifier does not fall back to an unpinned read and does not silently skip a failed RPC call.

## Adversarial coverage

`creator-v7-live-state-verifier-smoke.ts` and `creator-v7-live-state-actions-smoke.ts` cover:

- successful pinned-block paths for all four actions;
- deterministic verification receipts;
- wrong chain;
- runtime-code drift;
- topology drift;
- inactive or policy-mismatched modules;
- ERC-721 and ERC-1155 interface drift through Solidity vectors;
- non-committed freeze attempts;
- non-frozen collection deployment attempts;
- stale signer epochs and invalid media evidence;
- expired consent;
- wrong creator or payout manifest;
- missing frozen intent;
- prior collection or split deployment;
- exact-call failure, including invalid recipient consent;
- altered read-only return values;
- block-hash replacement;
- altered simulation receipts; and
- wrong interface anchors.

The smoke gate runs in CI.

## Remaining production blockers

- independently reviewed and published V7 production addresses and runtime hashes;
- an approved deployment sequence and verified explorer source;
- a trusted RPC strategy with explicit finality and outage behavior;
- an expiring verification cache keyed by chain, block hash, simulation ID and anchor set;
- a second fail-closed verification immediately before any wallet request;
- gas estimation and balance checks at that same execution context;
- a wallet surface that compares its exact `to`, `data`, `value`, chain and actor to the verified receipt;
- monitoring for module deactivation, runtime drift, registry changes and RPC disagreement;
- independent smart-contract and integration review; and
- separate explicit authorization for testnet or mainnet deployment.
