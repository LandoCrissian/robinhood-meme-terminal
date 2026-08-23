# NFT market threat model

NFT trading has a different failure surface from fungible swaps. A correct-looking floor price is not authorization evidence.

## Identity and chain truth

- Canonical item key is `(chainId, contract, tokenId)`, never name/symbol/slug.
- ERC-721 token IDs are uint256 black boxes; no sequential assumption.
- ERC-1155 token ID and quantity are both exact.
- Handle ERC-2309 `ConsecutiveTransfer` and ERC-1155 batch events.
- Reorgs roll back ownership and derived market state.
- Preserve Robinhood rollup and L1/Solidity block clocks separately when semantics require it.

## Hostile metadata

NFT metadata is attacker-controlled. Reject/isolate private-network URLs, redirect rebinding, credential URLs, unsupported schemes, decompression bombs, oversized responses, executable HTML/script, unsafe SVG behavior, MIME mismatches, malformed/recursive JSON and similar SSRF/XSS/resource-exhaustion paths.

Exact-contract search may still surface spam/phishing NFTs with warnings; heuristics must not fabricate nonexistence.

## Stale orders

`observed != fillable`.

Reverify immediately before authorization:

- NFT owner/balance/burn state;
- NFT approval/operator;
- payment balance/allowance;
- Seaport cancellation/counter/fill/expiry;
- zone policy;
- criteria proof;
- provider deployment/runtime;
- quote/checkpoint freshness;
- full outer-transaction simulation.

## Seaport verification

For every execution candidate independently verify chain 4663, pinned Seaport runtime, exact order hash, signature/EIP-1271, status/counter, time, zone, conduit, NFT type/contract/tokenId/quantity, criteria proof, ownership, approvals, payment asset/amount, every consideration recipient/amount, optional-vs-required creator fee, exact NFT recipient, target/value/selector/calldata structure, no unexplained calls, fresh simulation and receipt reconciliation.

Marketplace fulfillment data is provider input, never the proof itself.

## Approvals

- Prefer least privilege.
- `setApprovalForAll` is materially broader than an ERC-20 exact allowance and must be disclosed.
- Never approve an unverified conduit/operator/executor.
- Approval success is not trade success and settles zero RMT fee.
- Executor-created ERC-20 approvals must not leave reusable residual allowance without separate admission.

## Royalties and marketplace fees

ERC-2981 is advisory; the actual venue/order determines whether a royalty is required or optional.

Never derive the RMT fee by summing marketplace and royalty lines. Canonical RMT NFT fee basis is the normalized **venue gross payment** exactly once.

## RMT NFT execution fee security

Research economic rule: 25 bps, floor rounding, no minimum, successful authenticated RMT buys and sells only.

Hard invariants:

- NFT is never the fee asset;
- fee asset equals the trade payment asset;
- buy fee is a buyer-side payment surcharge;
- sell fee is deducted from seller payment proceeds;
- signed external maker order is not modified;
- exact venue consideration remains preserved;
- fee amount, treasury, policy hash, order hash, item, recipient, payment asset and deadline are pre-sign bound;
- provider fill and fee transfer are one atomic outcome;
- approvals/signatures/cancellations settle zero;
- failed/reverted execution settles zero;
- successful receipt without atomic fee proof fails closed;
- direct-provider wallet fallback cannot be labeled an RMT fee-admitted execution;
- marketplace-observed trades never become RMT revenue by indexing alone.

### Seaport listing buy

Use a pinned RMT executor as fulfiller and explicit user NFT recipient. Preserve exact Seaport consideration and transfer the separate RMT fee in the same outer transaction. Restrict to decoded/allowlisted provider function semantics; no generic arbitrary-call executor.

### Seaport offer sell

Do not require temporary custody of seller NFT as a shortcut. Use the unchanged maker offer plus a seller counter-order whose signed consideration explicitly binds seller net, required venue/royalty recipients and exact RMT fee. Match atomically with side-specific verification.

## Partial fills / criteria

ERC-1155 quantities and Seaport partial fractions must divide exactly. Collection/trait orders require the selected item to satisfy the exact signed criteria root/proof. UI labels are not proof.

## ERC-6551

TBA holdings are optional enrichment. Protect against recursive ownership graphs, duplicate accounts/implementations, assets moving between valuation and purchase and double-counted wallet holdings. Contained NAV is not guaranteed sale value.

## Manipulated activity

Do not claim “wash-free.” Expose structural signals such as self-trades, rapid round trips, repeated counterparties, concentration, buyer/seller diversity, spread and backed depth with explicit uncertainty.

## Source/API compromise

- APIs are evidence sources, not chain authority.
- Pin protocol/deployment identity independently.
- Bound schemas, sizes, timeouts and cursors.
- Unknown authorization-affecting fields fail closed.
- Stale read-only snapshots may remain visible where truthful; stale authorization never survives.

## Runtime separation

Indexer: read-only, no keys/signing.  
Quote observer: server credentials only.  
Verifier: deterministic/provider-specific.  
Fee verifier: deterministic policy + atomic settlement proof.  
Authorization codec: reviewed payload kinds only.  
Wallet submission: user-controlled signer.  
Reconciler: proves provider execution and fee settlement after submission.

No layer may absorb the next layer's authority for convenience.
