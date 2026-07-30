# V7 live-state verification

Status: source-level read-only verifier

Scope: consent-bound split deployment only

Signing: disabled

Broadcasting: disabled

Production anchors: none

## Purpose

`creator-v7-live-state-verifier.ts` closes the gap between deterministic review calldata and caller-supplied chain claims. It verifies one prepared consent-bound split deployment against one pinned block without changing state.

A successful result is evidence about that exact block. It is not a wallet authorization, audit, safety guarantee, gas estimate, finality guarantee or promise that the transaction will still succeed later.

Every result sets:

- `readOnlyExecution: eth_call_only`;
- `validForSigning: false`;
- `signing: disabled`; and
- `broadcasting: disabled`.

These fields remain disabled even when all checks pass.

## Reviewed anchors

The verifier accepts no default contract address or runtime hash. Its caller must supply separately reviewed anchors for:

- chain ID;
- V7 module-registry address and runtime code hash;
- V7 release-registry address and runtime code hash;
- consent-bound split-module address and runtime code hash;
- exact module key;
- reviewed split policy and metadata hashes; and
- the fixed version-1 split interface ID, `0xe161dd4b`.

The three contract addresses must be distinct and every address, bytes4 value and bytes32 fingerprint must be nonzero and well formed.

No production anchors are defined in this increment.

## Pinned verification sequence

The verifier stops at the first failed requirement and returns a deterministic failed receipt. It:

1. recomputes the simulation fingerprint and rejects an altered explanation or calldata;
2. verifies the connected chain against both the reviewed anchor and simulation;
3. pins the latest block number, hash and timestamp;
4. reads every contract at that exact block;
5. hashes the module-registry, release-registry and split-module runtime bytecode and compares each to its reviewed anchor;
6. verifies the release registry and split module point to the reviewed topology;
7. reads the append-only module record and verifies:
   - kind `3`;
   - version `1`;
   - implementation address;
   - interface ID;
   - implementation runtime hash;
   - policy hash;
   - metadata hash;
   - active state;
   - zero deactivation timestamp;
   - kind/version lookup; and
   - locally recomputed module key;
8. decodes the exact `deploySplit` calldata and recomputes its configuration, payout and consent manifests;
9. verifies the consent deadline is strictly later than the pinned timestamp;
10. verifies the release is frozen, owned by the expected creator and bound to the exact payout manifest;
11. verifies the exact module configuration and payout manifest through the release registry;
12. verifies that no split is already recorded;
13. executes the exact calldata from the creator through `eth_call` at the pinned block; and
14. rereads the pinned block and rejects a changed hash.

The read-only call exercises the actual module logic, including every EOA or ERC-1271 recipient consent, the current deadline, active-module checks, frozen intent, payout manifest and deterministic deployment path. The returned split address is recorded as evidence but no contract is persisted.

## Failure behavior

RPC errors, absent code, malformed receipts, runtime drift, registry drift, inactive modules, altered policy, wrong creators, unfrozen releases, changed manifests, expired consent, prior deployment, invalid signatures, call reverts and immediate block replacement all fail closed.

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

`creator-v7-live-state-verifier-smoke.ts` covers:

- the complete successful pinned-block path;
- deterministic verification receipts;
- wrong chain;
- runtime-code drift;
- topology drift;
- inactive or policy-mismatched modules;
- expired consent;
- wrong creator or payout manifest;
- missing frozen intent;
- prior split deployment;
- exact-call failure, including invalid recipient consent;
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
