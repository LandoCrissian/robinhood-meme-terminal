# NFT market threat model

NFT trading has a different failure surface from fungible swaps. A visually correct floor price is not sufficient evidence for a safe transaction.

## 1. Identity and spoofing

- Canonical item key is `(chainId, contract, tokenId)`, never name/symbol/slug.
- ERC-721 token IDs are black-box uint256 values; no sequential assumption.
- ERC-1155 token ID and quantity must both be exact.
- Same-name collections remain distinct.
- Market source, collection/project origin and RMT execution attribution stay separate.

## 2. Missing mint/ownership evidence

- Handle ERC-2309 `ConsecutiveTransfer` in addition to ERC-721 `Transfer`.
- Handle ERC-1155 single and batch transfers transactionally.
- Constructor-minted ERC-721 edge cases may require contract-specific supply discovery; absence of a mint log alone is not proof of nonexistence.
- Reorgs must rollback ownership and derived market state.

## 3. Malicious metadata

Token metadata is attacker-controlled input.

Reject or isolate:

- localhost/private/link-local/multicast URLs;
- redirect-to-private-network chains;
- credential-bearing URLs;
- unsupported schemes;
- unbounded response bodies/decompression bombs;
- executable HTML/script;
- unsafe SVG behavior;
- malformed JSON and recursive objects;
- media MIME mismatch.

Never let token metadata become server-side request forgery or browser script execution.

## 4. Phishing/spam collections

A permissionless chain will contain airdropped lure NFTs. Risk signals may warn/de-rank, but should not fabricate nonexistence. Search may still return the exact contract with an explicit warning.

Useful signals include multiple independent indicators: suspicious URLs, lure language, symbol/title duplication, unusual punctuation/emoji, mass unsolicited distribution and known malicious destinations. Treat heuristic output as evidence, not a verdict.

## 5. Stale listings/offers

An observed order can become invalid because of:

- NFT transfer/burn;
- ERC-1155 balance change;
- approval revocation;
- payment balance/allowance change;
- Seaport cancellation;
- Seaport counter increment;
- partial fill;
- expiry;
- zone policy;
- protocol pause/change;
- reorg.

Therefore `observed` != `fillable`. Verification and a fresh simulation happen immediately before authorization.

## 6. Seaport-specific verification

For the first verification-ready venue, independently check:

1. chain ID 4663;
2. pinned Seaport 1.6 target/runtime;
3. exact order hash and protocol address;
4. current order status, filled amount, cancellation/counter state;
5. maker signature or EIP-1271 result;
6. start/end time;
7. zone + zoneHash semantics;
8. conduit key resolved to the actual transfer spender;
9. offered/considered NFT contract, token ID, quantity and item type;
10. criteria root/proof for collection/trait orders;
11. current owner/ERC-1155 balance;
12. exact NFT operator approval;
13. payment token, amount and native value;
14. buyer WETH balance/allowance for offers where applicable;
15. every consideration recipient and amount;
16. optional vs required creator fees;
17. exact recipient;
18. transaction target/value/function selector and calldata structure;
19. reject unaccounted extra calls/consideration;
20. fresh `eth_call`/trace simulation;
21. quote/checkpoint freshness;
22. receipt reconciliation after submission.

Do not blindly forward calldata returned by a marketplace API.

## 7. Criteria orders

Collection and trait bids can use criteria roots/proofs. RMT must prove the selected token satisfies the exact criteria included in the signed order. A UI label such as “collection offer” is not sufficient.

## 8. Approvals

- Prefer exact/least privilege where protocol mechanics allow it.
- `setApprovalForAll` is materially broader than ERC-20 exact allowance and must be disclosed as such.
- Never approve an unverified conduit/operator.
- Approval success is not trade success and settles no RMT fee.
- Approval recovery/revocation must be independently manageable.

## 9. Royalties and fees

ERC-2981 reports royalty information; it does not itself force marketplaces to pay it. Quote economics must reflect what the **actual order/venue** requires or optionally includes.

No NFT RMT fee exists in this research package. Do not inherit fungible execution fee policy by name or percentage.

## 10. ERC-1155 partial fills

Quantities, remaining units, per-unit economics and partial fill state must be exact. A token ID can have many owners simultaneously; ERC-721 ownership assumptions do not apply.

## 11. Token-bound accounts (ERC-6551)

An NFT may control one or more token-bound accounts. Treat TBA holdings as optional portfolio enrichment with explicit registry/implementation/salt identity. Threats include:

- recursive ownership graphs;
- NFT owning another NFT that points back to the first;
- duplicate TBA implementations for one token;
- assets leaving between valuation and purchase;
- double-counting TBA assets already in wallet portfolio;
- assuming an NFT sale automatically conveys every external right associated with held assets.

TBA NAV is not guaranteed sale value.

## 12. Wash/manipulated activity

Do not call activity “wash-free.” RMT can expose structural evidence such as self-trades, rapid round trips, repeated counterparty pairs, concentration, buyer/seller diversity, spread and backed bid depth. Keep the score explainable and label uncertainty.

## 13. Source/API compromise

- Marketplace APIs are evidence sources, not chain authority.
- Pin protocol/deployment identity independently.
- Bound response size, schemas, timeouts and cursors.
- Reject unknown fields at the strict verification boundary when they affect authorization.
- Preserve last-good read-only snapshots as stale where safe; never preserve stale authorization.

## 14. Robinhood dual clocks

Do not compare rollup `eth_blockNumber` with a contract value based on Solidity `block.number`. Persist both clocks when semantics require it.

## 15. Runtime separation

Indexer: read-only, no keys.

Quote observer: server-side credentials only, no signing.

Verifier: deterministic, provider-specific, no signing.

Authorization codec: constructs only reviewed payload kinds.

Wallet submission: user-controlled self-custody signer.

Reconciler: proves what happened after submission.

No layer is allowed to “helpfully” absorb the next layer's authority.
