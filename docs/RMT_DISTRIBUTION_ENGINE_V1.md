# RMT Distribution Engine V1

**Status:** CONTRACT + OFFCHAIN PLANNING + FORK/ADVERSARIAL FOUNDATION — NOT DEPLOYED, NOT ACTIVATED
**Chain:** Robinhood Chain mainnet (`4663`)
**Product domain:** `distribution_utility`

## Purpose and boundary

`RMTDistributionEngineV1` is a typed, non-custodial distribution primitive for ERC-20, ERC-721 and ERC-1155 assets. A successful batch retires a deterministic amount of RMT to `RMTRetirementSinkV1` in the same atomic transaction.

This utility is separate from terminal trading and `RMT_EXECUTION_V1`. It does not change the RMT token, terminal fee policy, treasury, VNext execution providers, wallet gateway or production environment. No deployment or public interface is authorized by this implementation.

## Exact trust boundary

The engine is:

- chain-bound to Robinhood Chain `4663`;
- non-upgradeable and ownerless;
- limited to four typed distribution methods;
- unable to accept an asset-source address other than `msg.sender`;
- unable to call an arbitrary target or caller-supplied calldata;
- unable to rescue, sweep or withdraw assets;
- protected by `nonReentrant`;
- bound to the deployment-time runtime hashes of the RMT token and retirement sink;
- constructor-enforced to the exact compiled `RMTRetirementSinkV1` runtime rather than arbitrary sink code;
- configured with immutable, nonzero per-recipient utility costs.

The engine never takes an intermediate custody hop:

```text
distributed asset: sender -> recipient
RMT utility:       sender -> retirement sink
```

Any revert rolls back both paths.

## Retirement sink

`RMTRetirementSinkV1` intentionally exposes no functions. It has no owner, administrator, receive/fallback handler, withdrawal, rescue, sweep, arbitrary call, delegatecall, upgrade path or selfdestruct.

ERC-20 contracts can credit the sink without a receiver hook. Tokens sent to the sink are not recoverable through any sink method. This is **retirement**, not a native RMT supply burn: the existing RMT `totalSupply` does not decrease.

## Typed ABI

The only state-changing engine entry points are:

- `airdropERC20Equal(bytes32,address,address[],uint256)`
- `airdropERC20(bytes32,address,address[],uint256[])`
- `airdropERC721(bytes32,address,address[],uint256[])`
- `airdropERC1155(bytes32,address,address[],uint256[],uint256[])`

Read methods expose immutable configuration, consumed execution keys, deterministic utility quotes, execution-key derivation and action-specific batch hashes. There is no generic multicall or bytes-based execution method.

## Utility-cost model

The three constructor-supplied rates are:

- ERC-20 cost per recipient, shared by equal and custom distributions;
- ERC-721 cost per recipient;
- ERC-1155 cost per recipient.

The formula is:

```text
utility cost = immutable action rate * recipient count
```

This makes aggregate cost invariant under deterministic gas-safe batch splitting. The engine rejects zero rates, but this source does not choose production rates. Exact production values require a separate owner decision and deployment review.

## Replay and hashing

Each call supplies a nonzero `distributionId`. The consumed execution key is computed from:

- execution domain;
- chain `4663`;
- exact engine address;
- `msg.sender`;
- external distribution ID.

The same sender cannot consume an ID twice, including across action types. Different senders may independently use the same external ID. The key is marked before external token calls; a reverted transaction rolls the mark back.

The engine computes the batch hash from the action domain, exact asset address and exact typed arrays/amount. It never trusts a caller-supplied content hash. Array order is intentionally part of the hash.

## Exact-transfer policy

ERC-20 retirement and distribution verify exact sender debit and recipient credit balance deltas. This deliberately rejects fee-on-transfer, rebasing during execution, under-credit, over-debit and otherwise abnormal accounting. Standard no-return ERC-20 behavior remains supported through OpenZeppelin `SafeERC20` when exact balance postconditions also hold.

ERC-721 execution verifies caller ownership before transfer and exact recipient ownership afterward. It uses typed safe transfers, so a rejecting contract recipient reverts the whole batch.

ERC-1155 execution verifies exact caller debit, recipient credit and unchanged engine balance for every row. Receiver rejection and abnormal accounting revert the whole batch.

If the distributed asset is RMT, the caller needs allowance and balance for both the distribution total and the utility retirement. RMT receives no exemption.

## Recipient policy

Contract calls reject:

- empty recipient arrays;
- zero recipients;
- the engine itself;
- the retirement sink;
- `msg.sender` as a no-op/self-distribution recipient;
- zero amounts;
- mismatched arrays;
- zero or non-contract assets.

Duplicate recipients are allowed when each row represents a real exact transfer. Duplicate ERC-721 token IDs fail naturally when the second row no longer belongs to the caller.

## Canonical receipt

Exactly one `DistributionExecuted` event is emitted after a successful batch. It records:

- sender-bound execution key;
- sender;
- exact asset;
- external distribution ID;
- action kind;
- recipient count;
- total ERC-20/ERC-1155 quantity, or ERC-721 token count;
- exact RMT retired;
- immutable retirement sink;
- engine-computed batch hash.

Token-native transfer events provide row-level movement evidence. A later settlement decoder must reconcile both the canonical engine receipt and the expected token events/balance changes.

## HoodAirdrop prior art

The verified Robinhood Chain `HoodAirdrop` contract at `0x7bd896c76351250aCC46AA7DcB22C0106dbb1175` demonstrates the useful direct `safeTransferFrom(msg.sender, recipient, amount)` pattern and atomic loop behavior.

RMT retains those concepts but does not depend on or copy the deployment. V1 adds immutable RMT utility retirement, replay protection, non-reentrancy, exact-transfer rejection, multiple token standards, deterministic content hashes, runtime identity checks and a reconciliation-grade receipt. RMT does not adopt HoodAirdrop's fee-on-transfer tolerance or infinite-approval recommendation.

## Approval topology

The future planner must use exact ERC-20 approval amounts per batch where possible. ERC-721 and ERC-1155 may require per-token approval or `setApprovalForAll`; the engine still cannot move assets belonging to any address other than its caller. A future UI must disclose and offer post-job revocation for operator approvals.

## Prohibited capabilities

V1 has no native-ETH distribution, arbitrary calls, caller-selected `from`, Permit2, minting, claims, vesting, staking, launchpad behavior, cross-chain execution, server signer, autonomous execution, treasury collection or terminal-trading fee integration.

## Remaining release gates

Before any deployment or wallet integration:

1. focused and full Foundry tests, fuzzing and invariants must pass;
2. Slither's high-severity gate must pass with findings classified truthfully;
3. immutable production utility rates require explicit approval;
4. a real deployment/runtime manifest and independent review are required;
5. deployment requires separate authorization;
6. deployment must initially remain `deployed_not_publicly_activated`;
7. VNext Distribution Studio integration requires a separate reviewed PR.

No CCFF00 address, allocation or token-bound-account behavior exists in the generic contracts. CCFF00 is isolated in a read-only VNext adapter and remains the first canary use case.

## Deterministic offchain domain

The VNext-owned planning foundation lives in:

- `distribution-domain.ts`: strict import, canonical manifest and simulation-driven batching;
- `distribution-authorization.ts`: typed, non-submittable authorization plans;
- `distribution-settlement.ts`: exact event and token-transfer reconciliation.

The schema is versioned as `1` and binds chain `4663`, the checksummed sender and asset contract, token standard and decimals, canonical entries, optional snapshot/source evidence, utility-policy version and immutable rates, exact engine/sink/RMT identities and runtime hashes, per-action gas evidence, deterministic batches, totals, RMT retirement cost and hashes. Symbol and name are never asset identity.

Manifest JSON uses deterministic recursive key ordering. Rows are normalized and sorted before hashing, so equivalent input ordering yields the same manifest and batch identities. A parsed stored manifest is rebuilt from its own canonical CSV and security inputs; any mutation, unknown field or hash mismatch fails closed.

## Strict CSV schemas

The only accepted V1 headers are:

```text
ERC-20 equal:  recipient
ERC-20 custom: recipient,amount
ERC-721:       recipient,tokenId
ERC-1155:      recipient,tokenId,amount
```

Parsing rejects malformed or prohibited addresses, blank/missing rows, BOMs, quoting, whitespace mutation, schema mismatch, zero quantities, uint256 overflow, excessive decimal precision, signs, separators and scientific notation. The hard import ceiling is 10,000 rows; input is never truncated.

Duplicate policy is explicit:

- ERC-20: a recipient may appear only once;
- ERC-721: a token ID may appear only once, while one recipient may receive several distinct IDs;
- ERC-1155: a recipient/token-ID pair may appear only once.

Canonical ERC-20 CSV retains human decimal units while the manifest and authorization plan bind atomic integer amounts. NFT quantities and token IDs are canonical unsigned integers.

## Simulation-driven batch planning

The planner does not contain a magic recipient limit. It accepts action-specific Foundry or fork-simulation evidence bound to chain, action, measured block, block gas limit, safety margin and monotonic recipient-count/gas samples. The evidence receives its own deterministic hash.

The largest measured sample under the configured block-gas safety ceiling determines split size. The planner never extrapolates past measured evidence. Every batch binds the manifest, index, exact entries, onchain-compatible batch hash, exact utility cost and conservative measured gas. Splitting does not change aggregate RMT retirement:

```text
sum(batch utility cost) = immutable action rate * total recipient count
```

Confirmed settlement records remove batches from the pending set. Unknown, foreign or duplicate confirmed records fail closed; a confirmed batch is never planned for resend.

## Authorization-plan boundary

Authorization plans use only the four typed engine methods and bind target, sender, chain, batch, calldata/hash, zero native value, exact asset total, exact RMT retirement, sink and expected runtime identities.

Approval requirements are explicit:

- ERC-20 distribution: exact batch asset amount plus exact RMT utility approval;
- asset equal to RMT: one exact combined approval;
- ERC-721: exact per-token approvals plus exact RMT utility approval;
- ERC-1155: disclosed operator enable calldata, explicit revoke calldata/recommendation, plus exact RMT utility approval.

Every plan requires fresh runtime, allowance and simulation checks plus explicit user authorization. Both `walletSubmissionEnabled` and `serverSubmissionEnabled` are hard-coded `false`. There is no execute flag, signer, server submission or wallet prompt in this tranche.

## Settlement reconciliation

A batch becomes confirmed only when a successful chain-4663 receipt contains exactly one matching `DistributionExecuted` event and the exact expected token-native transfer evidence. Reconciliation validates execution key, sender, asset, action, recipient count, total, retired RMT, sink, batch ID/hash, unique log indexes, transaction hash and block identity.

ERC-20 and RMT transfers are compared as exact multisets. ERC-721 ownership transfers and ERC-1155 `TransferSingle` rows must match every authorized recipient/token/amount. When RMT itself is distributed, its distribution and retirement transfers are reconciled together without double counting. Indicative/planned totals never substitute for receipt evidence.

## Tranche 2 release state

The domain is integration-ready for synthetic planning and reconciliation tests only. No contract address, production utility rate, live simulation evidence, production runtime verifier, UI, deployment, approval, signature or transaction is enabled. Those remain separate reviewed tranches.

## CCFF00 read-only adapter

`distribution-ccff00.ts` is an isolated project adapter outside the generic contracts. It never reconstructs ERC-6551 addresses from guessed parameters. At one frozen Robinhood block it verifies the collection's exact registry, implementation, salt, account chain, CCFF00 token, configured token allocation, public/reserve counters and runtime bytecode, then calls the verified collection's own `getTokenBoundAccount(tokenId)`.

The adapter supports two explicit evidence scopes:

- `canaries`: IDs 470, 471 and 472 only, for inexpensive readiness checks;
- `full_public`: every currently minted public ID beginning at 1, required before a distribution manifest can be generated.

Reserve IDs are never inferred from a token name or frontend list. The adapter pins and validates the current contract boundaries: public IDs `1–9750`, founder reserve `9751–9770`, project reserve `9771–10000`, and total reserve 250. It also requires:

```text
totalSupply = publicMinted + reserveMinted
publicMinted <= 9,750
reserveMinted <= 250
```

Every snapshot binds its exact block/hash, collection and dependency runtime hashes, current owner, collection-returned TBA, account activation/runtime evidence, exact CCFF00 balance and exact RMT balance. Rows and the snapshot itself have deterministic hashes. Duplicate token IDs or token-bound accounts, incomplete declared coverage, runtime/configuration drift and mutated evidence fail closed.

### Historical and current evidence

The committed historical partial fixture records block `37451763` (hash `0xbfbff107fb35cb352a2a8e58fa3abd198f2c800c032ebe57b747958a992113dc`): 482 public mints, 250 reserves, 732 total NFTs, 482 unique public TBAs and the three historical canaries. It is explicitly `manifestEligible: false`; it cannot masquerade as a complete current recipient list.

The local read-only readiness command was run on 2026-08-16 at block `38070360` and observed:

- 519 public mints;
- 250 reserve mints;
- total supply 769;
- unchanged canonical TBAs for #470/#471/#472;
- exactly 10,000 CCFF00 in each canary TBA;
- zero RMT in each canary TBA;
- no deployed bytecode at any of the three canary TBAs.

A throttled complete public scan also succeeded at frozen block `38071486` (hash `0xa699b5e61ab452f919027f0b3c53f3ba9f3c814fbec4ec39d517b74f4b97b3ca`). It resolved the entire current 519-ID public range through `getTokenBoundAccount`, rejected no duplicate TBA, and produced deterministic snapshot hash `0x430b2ea894b39f32372fccc2873bd8cf8616b1812a6348ebf20483ba68e24962`. This is evidence of the read-only adapter path, not an approved final recipient manifest; a fresh full snapshot remains mandatory immediately before any separately authorized execution.

This proves why `482` must never be a live constant. Run `pnpm --filter web readiness:vnext-distribution-ccff00` for a fresh canary snapshot. `--full-public-snapshot` remains read-only but intentionally performs the larger complete scan needed to produce full recipient evidence.

For comparison only, applying the historical 500-RMT proposal to the observed 519 public accounts would produce a 259,500-RMT distribution total before the separate immutable utility cost. That arithmetic is not an approved allocation, spending authority or final manifest.

### Manifest integration and canary gate

A complete snapshot can feed the generic ERC-20 equal-distribution planner. The resulting manifest distributes the exact official RMT contract to the exact frozen TBA set and binds the CCFF00 snapshot hash as source evidence. The proposed 500-RMT historical allocation remains caller-supplied fixture data, not adapter policy.

The adapter always returns explicit release blockers. Mass distribution remains ineligible until separate evidence proves all three 1-RMT canary deposits, at least one account activation/runtime binding, and owner-controlled withdrawal. The engine must also be deployed and reviewed separately. Neither the readiness command nor adapter contains wallet, signer, approval, submission or transaction capability.

## Robinhood fork and adversarial evidence

The opt-in Foundry rehearsal uses a Robinhood mainnet fork and never broadcasts. At fork block `38088963`, it independently verified the official RMT contract at `0xdBa33be56C89CC9fc014c4459028d7e5c7878671`, including runtime hash `0x49cd48d0204b35d27e6fca131febe8ce5aff6cd0c2fb6c5c21d5f0ad616e99e9`, then locally deployed the sink and engine against that exact token.

The fork proved:

- exact combined approval when RMT is both the distributed asset and retirement asset;
- direct official-RMT sender-to-recipient delivery;
- exact official-RMT retirement into the local sink;
- zero engine balance after success;
- a later distribution failure rolls back the earlier RMT retirement and replay consumption;
- realistic official-RMT gas samples without live writes.

| Recipients | Fork gas used |
| ---: | ---: |
| 10 | 399,978 |
| 25 | 857,998 |
| 50 | 1,668,994 |
| 100 | 3,292,085 |
| 200 | 6,542,651 |

These samples are engineering evidence, not a permanent public batch limit. The manifest planner still requires current action-specific evidence and its configured safety margin. The fork command is opt-in through `RMT_RUN_DISTRIBUTION_FORK=true`; ordinary contract tests do not make network calls.

The focused adversarial suite covers false-return, reverting, no-return, fee-on-transfer, over-debit, abnormal RMT retirement, receiver rejection, missing approvals, ownership mismatch, reentrancy, runtime drift, replay, donated balances and atomic rollback. Passing this suite does not authorize deployment.

## Deployment and runtime verification boundary

`distribution-runtime.ts` defines the strict future deployment-manifest and live-read boundary. A valid manifest must record the exact source commit, Solidity `0.8.26` optimizer/via-IR settings, constructor arguments, deployer, deployment transaction/block, engine and sink addresses/runtime hashes, official RMT runtime hash and a hard-disabled activation state.

Immediately before any future wallet authorization, a reader must freeze one canonical Robinhood block and independently verify:

- chain `4663` and canonical block identity;
- engine, sink and RMT bytecode hashes;
- engine `CHAIN_ID` and every immutable address/runtime binding;
- every immutable per-recipient utility rate;
- empty EIP-1967 implementation slots for both non-proxy contracts.

Unknown fields, missing code, proxy drift or any identity/rate mismatch fail closed. Even successfully verified technical evidence returns `publicActivationEligible: false`, `walletSubmissionEnabled: false` and `serverSubmissionEnabled: false` in this tranche.

No production distribution deployment manifest exists yet. No fallback, predicted, guessed or symbol-derived address is accepted.

## Authorization-plan fixtures

Deterministic UI fixtures exercise all four typed actions: equal ERC-20, custom ERC-20, ERC-721 and ERC-1155. Each fixture decodes back to its one admitted engine selector, exact sender/asset/batch, zero native value and explicit approval topology. They remain planning fixtures only; wallet and server submission are hard-disabled.
