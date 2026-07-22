# RMT Consent-Based Sushi V3 Liquidity Migration

RMT's migration research is limited to helping an owner use tokens already controlled by that owner's wallet to create a new, directly owned Sushi V3 position on Robinhood Chain. It does not search for exploitable contracts, claim abandoned-looking assets, withdraw third-party liquidity, or move assets without the owner's transaction.

The implementation is isolated from the live V6 launch factory, markets, governance bootstrap, and permanently locked graduation position. Its bytecode is hard-gated to Robinhood Chain testnet (`46630`). One source-verified, initially paused, no-value rehearsal is deployed there using an RMT-operated Sushi V3 ABI-compatible test fixture. No real-value assets may be used. This is not an official Sushi or Robinhood product, endorsement, or partnership.

## Current release state

| Surface | State |
| --- | --- |
| Consent router and accounting-session logic | Implemented, adversarially tested, and deployed in a no-value rehearsal |
| Robinhood Chain testnet deployment | Source verified; current state reproduced by a fail-closed, read-only public proof panel |
| Migration transaction UI | Disabled |
| Mainnet | Prohibited by contract bytecode |
| Security audit | Not completed |
| Legal/compliance review | Not completed |

## Safety-first product model

The earlier pooled-vault and generic-executor designs were removed. The current design has no shared customer vault and no third-party seeder or verifier:

1. The owner exits or converts an old position outside RMT.
2. The owner uses a reviewed bridge to deliver supported tokens to their own Robinhood Chain wallet.
3. The owner reviews the exact pool, fee tier, tick range, amount limits, deadline, and deployment-bound terms hash.
4. That wallet calls the testnet router and supplies only its own approved tokens.
5. A permanently bound accounting session snapshots the wallet and session balances onchain, then calls one immutable Sushi V3 non-fungible position manager.
6. The manager must mint a brand-new position NFT to the same caller.
7. Every unused token from a successful migration returns to the caller and manager allowances must be zero before completion.
8. Any configuration, accounting, approval, ownership, position, liquidity, tick, amount, or deadline failure reverts the entire transaction.

There is no beneficiary override, pooled campaign, custody period, delayed claim, bridge adapter, source-pool call, generic executor, arbitrary call, upgrade path, liquidity withdrawal, or administrative token sweep.

A normal wallet flow includes two exact-amount ERC-20 approvals before the atomic `migrate` call. “Atomic” describes the token movement, accounting, test-position mint, verification, and refunds inside that final call; it does not collapse prerequisite approvals into one transaction.

## Implemented contracts

### `RMTConsentLiquidityMigrator`

The testnet-only router enforces:

- one immutable paired-token/WETH market, one immutable Sushi V3 manager, factory, and pool, and one code-bound accounting session;
- exact runtime code-hash checks at construction, enablement, and every migration;
- manager-to-factory, manager-to-WETH, factory-to-pool, and pool-to-token/fee/tick-spacing bindings;
- an initially paused deployment that only the configured governance contract can enable;
- caller-funded migration with the caller hard-coded as the new position recipient;
- a direct `mint` call using Sushi V3's official position-manager ABI rather than a generic executor;
- a one-position increase in manager supply, the returned ID at the newly appended enumerable index, direct caller ownership, and exact token, fee, tick, and liquidity reads before and after refunds;
- user-selected desired amounts, minimum token use, minimum liquidity, aligned tick range, and a maximum one-hour deadline;
- exact onchain wallet and session balance snapshots immediately before transfer, exact final balances after verified use and refunds, preserved pre-existing session balances, and zero session-to-manager allowance after success;
- rejection of inbound-fee, outbound-fee, malformed-approval, usage-misreporting, redirected-position, reused-position, callback-reentry, and broken-binding behavior;
- a consent hash bound to the terms document and exact chain, router, governance, guardian, tokens, integrations, fee tier, and runtime hashes;
- a migration identifier bound to every amount limit, liquidity limit, tick, deadline, caller nonce, and accepted terms hash;
- OpenZeppelin reentrancy guards on both the router and session plus immediate guardian/governance pause;
- rejection of native currency and a constructor-enforced Robinhood Chain testnet-only gate.

### `RMTConsentLiquiditySession`

The normally deployed, reusable session is permanently bound to one router, token pair, manager, fee tier, and Robinhood Chain testnet. Only that router can open or execute a session. It records exact wallet and session balances onchain, clears active session state before token, manager, or refund callbacks, requires exact manager outflows and final balances, verifies the position before and after refunds, and checks manager allowances both before and after refund callbacks. It has no administrator, upgrade path, generic call, withdrawal, sweep, or native-currency receiver.

The minimal ABI matches Sushi's official [`INonfungiblePositionManager`](https://github.com/sushiswap/v3-periphery/blob/master/contracts/interfaces/INonfungiblePositionManager.sol), where `mint` returns a new position ID, liquidity, and actual token amounts, and `positions` exposes the position's pair, fee, ticks, and liquidity.

## Important limits

Runtime code hashes are necessary deployment evidence, but a proxy can keep the same outer code while changing its implementation. Before any deployment, each manager, factory, pool, WETH, and paired token must be proven to use the reviewed non-upgradeable implementation or have its complete upgrade authority and implementation binding separately controlled and reviewed. Environment variables alone are not trusted deployment evidence.

Matching an onchain hash proves that the transaction contained that hash. It does not by itself prove that a person read or understood the document. A production flow would also need the exact published terms, clear UI presentation, versioning and retention of the user's acceptance record, and qualified legal review.

User-selected minimum token amounts are execution bounds, not an independent oracle or time-weighted price guarantee. Any public release would need a reviewed quote and price-deviation policy appropriate to the fixed pool, plus clear price-impact disclosures.

The accounting session does not trust wallet-supplied balance claims. In the same atomic transaction, the router asks the session to record exact wallet and session balances before any input transfer. The session then receives the two exact requested amounts, mints through the bound manager, clears approvals, returns computed refunds, and requires both the wallet and session to finish at the exact balances implied by verified manager use. Any fee, unexpected debit, manager misreport, or callback mutation of a verified balance, approval, position, or binding reverts the whole transaction. Pre-existing session dust is preserved rather than treated as migratable value.

ERC-20 tokens can be transferred directly to any contract address. Because neither the router nor session has sweep or recovery authority, tokens sent directly to either address can be permanently stuck. Users must never transfer tokens to either contract; a migration must begin through the reviewed transaction flow. Exact accounting applies to a successful `migrate` call and preserves unsolicited session balances; it does not create a recovery path for mistaken transfers.

Sushi V3 mints the LP NFT with `_mint`, not ERC-721 receiver negotiation. A contract wallet will own the position at its own address and must be able to call the position manager later. Representative Safe and account-abstraction wallets must be tested deliberately before public support; unsupported contract callers must be blocked in the UI.

## Consent and source-chain boundary

RMT never touches the old position. The owner must withdraw and bridge externally, and the destination transaction must be sent by the wallet that receives the new LP NFT. Read-only market discovery may identify fragmented liquidity, but discovery creates no authority to access or move any asset.

Any future delegated or one-click bridge path would need a bridge-specific proof of source ownership, a signed instruction binding the destination owner and amounts, finality and replay protection, retry and refund handling, and separate legal and security review. It is outside this prototype.

## Verified testnet rehearsal

On July 18, 2026, RMT deployed the isolated rehearsal on Robinhood Chain Testnet through two deterministic CREATE2 transactions, each with value `0`. The RMT-operated rehearsal venue is at [`0x10af03B200b2487815dfBE4922810a7b9640A884`](https://explorer.testnet.chain.robinhood.com/address/0x10af03B200b2487815dfBE4922810a7b9640A884), the atomic consent stack is at [`0x662F4dC5fE4115BE317BeFc0D77f4C1d6adeE576`](https://explorer.testnet.chain.robinhood.com/address/0x662F4dC5fE4115BE317BeFc0D77f4C1d6adeE576), and the initially paused migrator is at [`0x01Cdc5FA002F0dEee4B153D31763392EC81e8f05`](https://explorer.testnet.chain.robinhood.com/address/0x01Cdc5FA002F0dEee4B153D31763392EC81e8f05). Its current state is reproduced by the public proof panel rather than asserted by static copy.

All ten exact contract instances are source verified with Solidity `0.8.26`, Cancun EVM, optimizer 200, and via-IR. The canonical evidence is the [durable deployment record](../packages/contracts/deployments/robinhood-testnet-consent-rehearsal-2026-07-18.json) and the [testnet rehearsal runbook](CONSENT_TESTNET_REHEARSAL_DEPLOYMENT.md). The hosted application exposes no deployment or execution route.

The public `/rescue` surface includes a read-only proof panel backed by a short-lived status endpoint. It reproduces the current chain ID, block freshness, all ten runtime hashes, immutable configuration and terms hashes, governance policy/history, pause state, position supply, session state, and router/session token balances. The endpoint accepts no input and contains no wallet or write path. A failed refresh immediately removes the green live status; RPC unavailability is shown as unavailable, while any chain, hash, binding, or pause-boundary mismatch is shown as requiring attention. The durable deployment facts remain visible, but they are never presented as a successful current-chain check after a failed read.

The deployed venue is a valueless RMT test fixture that matches the reviewed Sushi V3 ABI boundary. It is not an official Sushi deployment or production AMM: it performs no price discovery or swaps, generates no fees, and its deliberately minimal sink fixture has no liquidity-withdrawal or collection path. It can demonstrate bounded consent, accounting, and direct test-NFT ownership only. The separately configured integration deployment script remains locked behind a zero approved-manifest hash, so environment variables cannot turn this rehearsal into an official or mainnet deployment. Any activation, official Sushi integration, or real-value use requires a separate reviewed release.

## Legal and compliance release gates

Self-custody, explicit wallet authorization, and the absence of contract-exploitation features reduce risk; they do not establish that operating the completed product is lawful in every jurisdiction. Before any public execution path, qualified counsel must review the actual entities, jurisdictions, software control, fees, incentives, marketing, and user flow, including:

- federal and state money-transmission and custody rules;
- securities and commodities treatment of each token, matching incentive, fee, and expected-return claim;
- OFAC sanctions screening, blocked-property procedures, and geographic controls;
- AML, recordkeeping, tax, privacy, and consumer-protection obligations;
- Sushi, bridge, token, wallet, and Robinhood terms and integration permissions;
- accurate disclosures with no promise of profit, recovery, automatic value generation, safety, or endorsement.

Primary U.S. references include [FinCEN's CVC guidance](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-certain-business-models), [OFAC's virtual-currency guidance](https://ofac.treasury.gov/system/files/126/virtual_currency_guidance_brochure.pdf), and [FTC advertising guidance](https://www.ftc.gov/business-guidance/advertising-marketing). These references are not legal advice and do not replace advice from RMT's own counsel.

## Mainnet blockers

- Officially confirmed Sushi Robinhood Chain manager, factory, pool, and WETH addresses.
- Independently reproduced runtime hashes and proof that every bound component is non-upgradeable or fully implementation-bound.
- Verified pool initialization, token ordering, fee tier, tick spacing, price state, and transaction-encoding policy.
- Fixed-behavior paired-token review, including upgrade authority and transfer semantics.
- Public, immutable, counsel-approved terms plus a reviewed UI consent record.
- Sanctions, AML, tax, privacy, consumer, custody, money-transmission, securities, and commodities review.
- Independent audits of the router, deployment configuration, web transaction builder, and operational controls.
- Representative smart-wallet mint, management, withdrawal, and recovery tests; unsupported contract-wallet flows must fail closed.
- Expanded Robinhood Chain testnet activation rehearsals covering price movement, failed execution, refunds, pausing, RPC disagreement, reorgs, and incident response.
- Explorer source verification, a signed public deployment manifest, and reproducible bytecode for any production stack.
- No unresolved high-severity static-analysis, dependency, test, review, or CI findings.

Until every blocker is closed, this remains a verified, no-value testnet rehearsal—not a production migration service, yield product, bounty hunter, asset-recovery tool, or promise that any position can be profitably redeployed. The current pause state does not change those release boundaries.
