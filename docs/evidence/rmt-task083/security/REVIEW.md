# Task 083 Seaport V2 custody security review

**BLOCKED_NO_BROADCAST. Production NFT acquisition remains NO-GO. Internal source/path assessment, not an independent audit.**

The separately versioned candidate is `RMTSeaportAcquisitionVaultV2`, with the constructor-created, stateless `SeaportAcquisitionChecksV2`. Neither Task 081 synthetic custody nor Task 082's read-only verifier is relabeled as Seaport custody. Existing Solidity and its prior findings are preserved. [Exact 23-row register](findings.json) · [Human matrix](FINDINGS.md) · [Compiler manifest](compiler-manifest.json).

The final Windows Slither 0.11.5 / Crytic Compile 0.3.11 run used **all 101 detectors**, all three new production-root sources and their unchanged Accounts import. It reports **48 observations: 23 High, six Medium, 13 Low and six Informational; strict exit 1**. No detector/source filter, suppression, severity override, relaxed balance assertion or independent clearance is applied. The raw final report is [windows-slither.json.gz](windows-slither.json.gz). Gzip is storage only: the original 1,962,101-byte JSON was scanned before compression and its SHA-256 is retained in [integrity.json](integrity.json).

The 23 High rows comprise one typed, pinned native Seaport call and 22 `reentrancy-balance` observations: 12 purchase baselines, eight noticed-withdrawal baselines and two funding baselines. Each machine row retains the exact ID, source/AST offset, source lines, external call, observed balance, later conditions, threatened asset, preconditions, guard/state transition, applicable named regressions, mitigation and uncertainty. These warnings remain unresolved. The internal review has not demonstrated a reachable loss under the reviewed pinned path; that is a finite assessment, not proof that none exists or authorization to accept risk.

The preliminary candidate input `af3ea1cc22b1ae81f4b84071694294f42379e9763bcd32d912823b4a426b4e08` and [its raw report](preliminary-slither.json.gz) remain separate evidence. The final constructor additionally requires the actual creator as deployer. This changes compiler metadata and twelve purchase finding IDs through Slither temporary-variable suffixes, without removing their source/call/balance/postcondition observations. The register maps all 23 preliminary IDs to final IDs: eleven identical, twelve relocated; **zero removed and zero cleared**. Both complete raw descriptions are preserved in the raw reports; the mapping normalizes only `TMP_N` / `REF_N` labels and requires a unique exact remaining description.

Task 082's **22 remaining acquisition Highs and original 23 finding IDs** remain in their independent register. V2 is a different ABI, route and custody implementation; its 23 observations cannot be subtracted from V1's 22 or presented as an in-place remediation. The 22 core, six Treasury V1, seven active Reclaim V2 and four rejected historical Reclaim V1 Highs remain separate release evidence.

## Immutable execution and source admission

The candidate accepts only chain **31337**, including a Robinhood fork whose local chain ID remains 31337. Its constructor binds the actual core project creator/token/curve, the explicit controller, intent, exact Seaport/payment runtimes and computed Seaport 1.6 EIP-712 domain. It records the observed conduit-controller address and runtime, and creates its own exact view helper. Every guarded operation rechecks these code and project bindings. A direct EOA creator can nominate a supported Safe controller; ordinary Safe `CALL` does not provide contract creation, so direct Safe-as-creator deployment is not claimed without a separately reviewed CreateCall/factory path.

The helper has no assets, mutable settings, approvals, fulfillment, payable functions, generic call, delegatecall or execution authority. Its only external interactions are typed view calls. It exists to keep genuine production candidates within EIP-170 without waiving size limits. The main vault has no arbitrary executor, user-selected fulfillment selector, proxy, upgrade or global NFT approval. Pins supplied to the constructor require independent exact source/runtime review; a matching hash or `information()` response is not an audit or proof that a deliberately malicious admitted implementation is honest. Payment proxy implementation/admin policy and collection upgrade semantics remain independent admission holds. No production pins are changed.

The only fulfillment is typed `fulfillAdvancedOrder`, with zero criteria resolvers, zero fulfiller conduit and the vault as receiver. The admitted order has one static ERC721 or ERC1155 sell offer, `FULL_OPEN`, fraction 1/1, no zone/zone hash, no offerer conduit, no criteria, extra data, restricted/partial/dynamic order or tips. Nonzero conduits are deliberately unsupported. The order's original consideration count must equal all supplied entries. V2 bounds consideration to ten entries; the retained read-only verifier's narrower eight-entry acceptance remains a restriction of that route, not new spending authority.

Seller EOA signatures are canonical low-s 65-byte or EIP-2098 encodings. Contract/delegated sellers must pass the unchanged narrow account profile, including actual SafeL2 1.4.1 proxy/singleton/handler, three distinct EOA owners, threshold two, no modules or guard; a generic ERC1271 fixture is unsupported. Genuine Safe seller tests sign the SafeMessage-wrapped Seaport digest, rather than using an EOA signature as a substitute. Order hash/domain/counter/signature/status are checked before fulfillment; complete 1/1 fulfillment, unchanged counter and valid signatures are checked afterwards.

## Funding, standing policy and custody

Only the current supported controller may deliberately supply separately settled native or admitted ERC20 funds. There is no ledger claim, diverted creator entitlement, cross-project fee source or automatic funding. Forced native or unsolicited unsafe ERC721 delivery is not credited and has no hidden sweep. This can strand unsolicited assets; it does not create a withdrawal entitlement.

Purchasing starts OFF. Explicit enabling grants **any caller** bounded standing authority to trigger permitted signed orders. The caller pays network gas, while the vault spends previously accounted unreserved capital. Collection runtime, standard, exact ID selection or explicit any-ID choice, quantity (at most 20; ERC721 exactly one), currency, all-in per-NFT cap, lifetime budget, UTC fixed-day budget, cooldown, deadline and both authority epochs are enforced onchain. A cap is spending authority, not valuation. A mined disable invalidates old requests; a fill mined before that disable can settle. No background keeper is enabled.

Every consideration entry is positive, static, denominated in the one policy currency and has a distinct nonzero recipient. Seller is first. Other nonroyalty recipients require controller admission while purchases are OFF, with per-recipient fee caps at most 1,000 bps. The collection's actual ERC2981 royalty must appear once with the exact amount based on total consideration; royalty identity/amount must also remain unchanged after settlement. Overlapping seller/fee/royalty identities are deliberately unsupported so exact endpoint deltas remain unambiguous. The vault checks every recipient's actual native/token credit as well as its own exact debit. Immediate forwarding/spending by native recipients fails these endpoint checks and rolls back; that is an explicit liveness restriction.

Native consideration is forwarded from deliberate prefunding with exact value; `purchase` is nonpayable and cannot silently use the trigger's transaction value. ERC20 approval starts at zero, is set only to the exact all-in amount for pinned Seaport, and is explicitly revoked and checked zero after fulfillment. Fee-on-transfer, over-pull, false returns or other unsupported behavior fails exact settlement and rolls back.

All fourteen mutable funding/policy/purchase/notice/controller entry points use the guard. It rejects reentry before dependency reads, which are typed view/static calls, and activates before the first mutable external effect. Order consumption, spending and cooldown are updated before fulfillment; any later failure reverts these updates and every nested transfer. ERC1155 accepts exactly one active expected Seaport operator/seller/collection/ID/quantity callback, followed by exact seller/vault balances. Genuine Seaport ERC721 uses `transferFrom` without a receiver hook: custody requires exact seller/vault collection balances and final `ownerOf`, not a callback flag. Safe ERC721 callbacks are rejected and confer no inventory credit.

Purchased NFTs are credited only to this exact vault. Asset/NFT exits require a controller-authored exact recipient/asset/ID/quantity notice, real two-day delay, execution window at most seven days after maturity, reservation and current epoch; at most sixteen notices can be pending. Execution is permissionless on those fixed terms and guarded. Exact endpoint and ownership failures restore notice, reservation, accounting and transfers atomically. Controller rotation has its own notice/acceptance, disables purchasing and invalidates old notices without resetting lifetime/day spend. A new controller or anyone after invalidation/expiry may clear stale notices without redirecting their assets.

## Compiler and test evidence

Final production input SHA-256: `3fbc55312a027e5f69b16fb927c8549efcc6674bab509c792efdc0104083c5f5`. Analysis input SHA-256: `aac799ac7a70756b9d117194bf4b6eadc6139d3bad988d3bfff5b628ab819fde`. Compiler: pinned solc **0.8.26+commit.8a97fa7a**, Cancun, optimizer 200, viaIR; Windows executable SHA-256 `537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67`. [Exact standard JSON](compiler-input.json.gz) · [Source and template hashes](compiler-manifest.json).

| Candidate | Runtime template | Creation template | Full constructor |
| --- | ---: | ---: | ---: |
| RMTSeaportAcquisitionVaultV2 | 24,071 bytes | 38,180 bytes | 38,532 bytes |
| SeaportAcquisitionChecksV2 | 9,880 bytes | 9,906 bytes | 9,906 bytes |

EIP-170 and EIP-3860 limits are compiler assertions; the genuine test also checks encoded constructor and deployed runtimes. Constructor-bound runtime hashes must be materialized for each actual address and are separate from these zero-immutable templates. No size limit is waived.

Pinned-solc ABI/AST/bytecode compilation passed for **48 Foundry groups**, including two fuzz groups and one stateful invariant: `PASS_NOT_EXECUTED`, test-input SHA-256 `17fb85874ef7e90bfa0f55e3bb9a59ef665571b2d7e7ae343932b6b01bdc718e`. This is compilation, **not EVM execution**. [Retained local result](local-syntax.json). Actual Foundry/Anvil/Linux/browser/fork receipts and CI failures/results must be reported separately by the acceptance record.

The new tests use genuine archived Seaport/controller creation bytecode, separately generated before Foundry, and actual archived Safe 1.4.1 runtimes with its real proxy factory, threshold-two transactions and SafeMessage order signatures. Synthetic project/assets/funding remain labeled fixtures. Cases cover four native/ERC20/ERC721/ERC1155 combinations; wrong identity/counter/epoch/deadline/signature/order subset; cancellation and prior partial fills; replay/same-block cooldown; fee/royalty changes; malicious payment/recipient/NFT callbacks; mature-notice reentry; immediate native/NFT forwarding; ERC20 false return/fee/over-pull; exact ID/runtime; reserve/day/lifetime/cooldown; notice/rotation; and conservation/inventory invariants. Finite coverage does not establish correctness of arbitrary future admitted assets or profiles. Production remains unavailable regardless of test results.

The unchanged Gitleaks 8.30.1 rules and historical ignore file separately scanned the final raw compiler input, compiler manifest, preliminary raw Slither and final raw Slither before their final compression. All four file scans returned zero; [scan provenance](raw-scan.json) retains bytes/hashes/commands/exits. This narrow artifact check does **not** replace or clear the retained full-history raw scanner failure or its exact public-identifier adjudication.

## Reproduction

Run from the repository root with the checksum-pinned compiler and existing Slither 0.11.5 / Crytic Compile 0.3.11 environment. Use fresh output/source paths; the historical analyzer asserts they do not already exist. It changes only outputSelection to request necessary AST/source maps, and registers every installed detector.

```text
node scripts/seaport-acquisition/compiler.mjs --solc <pinned-solc> --standard-json <fresh-input.json> --manifest <fresh-manifest.json>
python docs/evidence/rmt-task043/analyze-rotation.py <fresh-input.json> <pinned-solc-named-solc> <fresh-source-dir> <fresh-slither.json>
# Expected final exact input: 101 detectors; 48 findings; 23 High; strict exit 1.
node scripts/seaport-acquisition/compiler.mjs --solc <pinned-solc> --check-foundry-syntax
node scripts/seaport-verification/fixture-compile.mjs --solc <pinned-solc> --output packages/contracts/seaport-acquisition/official-artifacts.json
forge test --root packages/contracts/seaport-acquisition --use <pinned-solc> -vvv
node docs/evidence/rmt-task083/security/build-register.mjs
```

The first CI attempt failed before Foundry because its separate root could not resolve preserved sibling imports. The new Foundry configuration adds a narrow sibling remapping and retains allowed paths; no production source or import target was changed to bypass analysis. Preserve that initial failed log and require actual later execution evidence. No production transaction, funding, owner signature, deployment, fee/royalty change or service mutation follows from this review.
