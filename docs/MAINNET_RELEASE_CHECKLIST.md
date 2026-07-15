# Robinhood Meme Terminal V6 mainnet release checklist

This checklist is the final go/no-go gate for V6. Passing CI does not authorize deployment, activation, or public launches, and it is not a guarantee that unaudited contracts are risk-free.

## Canonical live dependencies

- Robinhood Chain mainnet chain ID: `4663`
- Gas asset: ETH
- Official public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Uniswap V4 PoolManager: `0x8366a39cC670b4001A1121b8F6A443A643E40951`
- Canonical CREATE2 deployer: `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- Existing expandable governance: `0x13C0A930516FB6bF0d467B38605d9D2a9c4C6953`
- Active V5 factory: `0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD`
- Version registry: `0x4b8b222B5CAa7066c02A54E51eC1a674ADf5b3A1`

Primary references:

- https://docs.robinhood.com/chain/connecting/
- https://developers.uniswap.org/docs/protocols/v4/deployments

The release preflight must read bytecode and state from the same production-capable Robinhood Chain RPC used for the rehearsal. A documentation or explorer label is not a substitute for executable bytecode. If the PoolManager, CREATE2 deployer, governance, V5 factory, or registry returns empty code, stop the release and resolve the chain/RPC discrepancy.

## Reviewed V6 parameters

| Parameter | V6 value |
| --- | ---: |
| Fixed token supply | 1,000,000,000 tokens |
| Bonding-curve trading fee | 1% |
| Creator share of realized fees | 70% |
| Protocol-treasury share of realized fees | 30% |
| Post-graduation V4 pool fee | 0.5% |
| Initial virtual ETH reserve | 0.3 ETH |
| Initial virtual token reserve | 1,017,500,000 tokens |
| Graduation target | 2 ETH net real reserve |
| Fair opening delay | 1 block |
| Fair protected window | 10 blocks |
| Fair maximum per buy | 1% of supply |
| Fair cumulative wallet maximum | 3% of supply |
| Policy/governance delay | 24 hours |
| Factory-registry activation delay | 48 hours |
| Launch reopening delay | 24 hours |

The 70/30 split applies both before graduation and to fees collected from the permanently locked V4 position after graduation. The V6 registry rejects policies with different canonical economics, another treasury, or any market or graduation-adapter address other than the two immutable reviewed components recorded at registry deployment. The current creator-share recipient receives fees, not ownership of the locked liquidity position or an extra token allocation. Splitters account fees only through the bound market/adapter methods, and the V4 hook rejects outside liquidity and donations, so arbitrary transfers cannot inflate fee analytics. If PoolManager enables an upstream protocol fee, the split applies to the remaining LP fees actually collected. Anyone may call fee collection, but cannot choose the recipients. Liquidity principal has no withdrawal path.

For the official V6 RMT launch only, creator and protocol treasury are the same verified RMTMain address, so its normal 70% and 30% payments reach one wallet and total 100% without an extra reward or duplicate accounting. Every ordinary launch keeps the disclosed 70% creator / 30% RMT result.

The final curve buy accepts only the gross amount needed to land on exactly 2 ETH net reserve. Excess is refunded or remains a payer-owned claim. Pending refunds, forced assets, and adapter seed dust are excluded from migration liquidity and fee splitting.

## Governance and creator-payout boundary

- The existing V5 governance stays only on the existing version registry. It begins with operator `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`, one signer, threshold 1, and a 24-hour delay, and is used only for the reviewed V6 factory-activation proposal.
- V6 deploys fresh governance with that operator as sole initial signer, threshold 1, immutable 24-hour delay, immutable seven-day execution window, cancellation, expiry, a public transaction getter, expiring proof-of-control acceptance bound to the current epoch, exact add-or-replace action, affected signer, and next threshold for every prospective added/replacement signer, candidate-controlled revocation of unconsumed consent before execution, atomic signer/threshold add-remove-replace operations, no multi-signer 1-of-N, and configuration-epoch invalidation of older proposals and unused acceptances. Adding the first extra wallet creates 2-of-2 governance, not a backup wallet; both signers are required afterward.
- A token creator cannot change the creator-fee payout wallet.
- Delayed RMT governance can propose moving future creator-fee payments only to the immutable protocol treasury, or restoring them to the immutable original creator.
- Every payout change is executed only by delayed governance and includes a public evidence hash plus the current replay-protection nonce; the creator has no acceptance or change action.
- The immutable RMT treasury may invalidate a stale unexecuted payout nonce but cannot select a recipient or move funds.
- Already paid or deferred creator rewards remain owned by the wallet that earned them.
- Uncollected V4 fees use the creator recipient active when collection occurs; the timing boundary is collection, not accrual.
- Governance cannot redirect a creator's 70% fee share to an unrelated wallet and cannot withdraw curve reserves or locked V4 liquidity.

## Fail-closed preflight

Before the first deployment transaction, the recovery-aware browser console must verify the following. The fork-rehearsal-only Foundry script must assert the same starting state:

- [ ] Chain ID is exactly `4663`.
- [ ] Existing V5 registry governance, V5 factory, registry, PoolManager, and CREATE2 deployer all have bytecode.
- [ ] The deployment wallet is exactly `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`.
- [ ] The existing registry governance recognizes that operator as its sole signer, with signer count 1, threshold 1, 24-hour delay, and zero proposals.
- [ ] The registry is governed by that exact existing governance contract and has a 48-hour activation delay.
- [ ] The registry still has the reviewed V5 factory and `RMT_FACTORY_V5` active.
- [ ] The registry has no pending factory, version, or activation timestamp.
- [ ] V5 reports `Robinhood Meme Terminal` and `RMT` as reserved.
- [ ] The production RPC is healthy and funded only for the intended release transactions.

Any mismatch blocks deployment. Do not override it in the website or script.

## Candidate evidence

- [ ] Freeze the exact source commit, compiler, optimizer, dependency lockfile, and generated deployment artifact; require both `acceptSignerRole(uint64,uint8,address,uint256,uint64)` and `revokeSignerRoleAcceptance(uint64)` in the generated V6 governance ABI and a fail-closed wallet console when either is absent.
- [ ] Complete contract tests, fuzzing, invariants, static analysis, web build, indexer checks, and the final Robinhood mainnet-fork workflow.
- [ ] Rehearse the V6 deployment against live dependencies on a fork created from the production RPC.
- [ ] Independently review the final commit, bytecode, economics, governance restrictions, locked-liquidity claim, and fee routing.
- [ ] Resolve every critical/high finding and obtain independent remediation review.
- [ ] Record the reviewed policy hashes and expected constructor arguments.
- [ ] Prepare Blockscout verification inputs before broadcast.
- [ ] Confirm mobile Safari, injected wallets, WalletConnect, and deep links can complete the required signatures reliably.

## Phased deployment and activation

- [ ] Deploy the new V6 governance, hook, adapter, paused launch gate, V6 market implementation, component-locked policy registry, and V6 factory in the reviewed order.
- [ ] Confirm all deployed addresses have bytecode.
- [ ] Verify hook flags and the permanent hook/adapter/factory bindings.
- [ ] Verify the PoolManager, pool fee, tick spacing, governance, guardian, delays, treasury, virtual reserves, and legacy V5 identity dependency.
- [ ] Verify the policy registry's immutable canonical market and graduation-adapter getters match the reviewed deployed addresses and reject substitutions.
- [ ] Verify the factory derives creator-payout authority from the shared governance used by the gate and policy registry.
- [ ] Verify the one-time official RMT migration is authorized only for the operator, has not been consumed, and both factory and helper are permanently bound to legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C` with the expected creator/name/ticker.
- [ ] Verify the factory refuses all launches until it is active in the version registry.
- [ ] Verify the factory refuses every ordinary launch until the exact official RMT migration has succeeded, even if the launch gate is accidentally opened early.
- [ ] Verify V6 remains paused and V5 remains the active registry factory.
- [ ] Confirm the deployment phase created zero governance proposals.
- [ ] Run the thirteen-contract source-verification script and then pass the console's live exact-source gate before submitting any proposal.
- [ ] Confirm both governance contracts have zero proposals before the first proposal; afterward, account for every ID in both contracts from exact receipts and inspect every V6 proposal's epoch, cancellation, expiry, approval, and execution state through its public getter.
- [ ] Read every governance proposal ID from its confirmed `Proposed` receipt event; never infer it from a local counter.
- [ ] Execute the delayed Fair-policy, Open-policy, default-policy, and registry phases only after each on-chain delay expires. Do not propose reopening yet.
- [ ] Activate `RMT_FACTORY_V6` only after policy hashes, source verification, and deployment bindings match the reviewed candidate.
- [ ] Keep the V6 launch gate paused throughout activation and production integration checks.
- [ ] Launch and verify the exact official RMT V6 migration while ordinary public launches remain paused; confirm the gate stays paused.
- [ ] Only after the official migration is verified, propose reopening through delayed governance and record the confirmed proposal ID.

## Final go-live gate

- [ ] Publish verified V6 source, addresses, transaction hashes, deployment block, immutable parameters, known limitations, and independent review report.
- [ ] Confirm the terminal and indexer use V6 capability and policy metadata and do not present legacy launches as V6 launches.
- [ ] Confirm price, market cap, volume, holder, and chart units are correct on desktop and mobile.
- [ ] Complete the exact official RMT migration while paused and verify its launch record, token, market, splitter, policy, supply, and unchanged gate state.
- [ ] Complete the full buy, sell, claim, graduation, post-graduation swap, and permissionless fee-collection rehearsal on the exact mainnet fork; after reopening, run only the separately approved bounded disposable live smoke transaction set.
- [ ] Verify the current creator-share recipient receives exactly 70% and the protocol treasury receives exactly 30% of realized pre- and post-graduation fees.
- [ ] Verify neither the collector, creator, operator, governance, adapter, nor hook can remove locked liquidity principal.
- [ ] Verify monitoring, incident response, RPC fallbacks, and operator contacts are active.
- [ ] Verify the browser, server feed, health checks, and indexer use restricted production-capable RPC endpoints with provider-side rate and spend limits; do not rely on the rate-limited public RPC for launch traffic.
- [ ] Obtain explicit manual approval for CI, artifact review, independent audit, monitoring, and operator readiness; these cannot be proven by the console.
- [ ] After the full reopening delay, require the console's fresh binding, policy, official-migration, dual-governance history, and thirteen-source checks, then execute reopening and re-run production health checks.

Public token creation remains closed until every required item above is complete.
