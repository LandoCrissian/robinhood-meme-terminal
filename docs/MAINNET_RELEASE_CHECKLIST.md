# Robinhood Meme Terminal V6 mainnet release checklist

This checklist is the final go/no-go gate for V6. Passing CI does not authorize deployment, activation, or public launches, and it is not a guarantee that unaudited contracts are risk-free.

## Canonical live dependencies

- Robinhood Chain mainnet chain ID: `4663`
- Gas asset: ETH
- Official public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Uniswap V4 PoolManager: `0x8366a39cC670b4001A1121b8F6A443A643E40951`
- Canonical CREATE2 deployer: `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- Active V5 factory: `0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD`

Primary references:

- https://docs.robinhood.com/chain/connecting/
- https://developers.uniswap.org/docs/protocols/v4/deployments

The release preflight must read bytecode and state from the same production-capable Robinhood Chain RPC used for the rehearsal. A documentation or explorer label is not a substitute for executable bytecode. If the PoolManager, CREATE2 deployer, V5 identity factory, or exact legacy RMT token returns empty code, stop the release and resolve the chain/RPC discrepancy. V6 deploys its own governance/treasury and registry; the legacy V5 governance and old registry are not V6 dependencies.

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

For the official V6 RMT launch, the verified RMTMain operator is the creator recipient and receives the normal 70% share. The separate V6 governance contract is the protocol treasury and receives the normal 30% share. It is not a same-wallet 100% payout. Every ordinary launch keeps the same disclosed 70% creator / 30% V6-governance-treasury result.

The official V6 “migration” creates a new token contract with a new address and new fixed supply of 1,000,000,000 tokens. It does not copy, swap, credit, or migrate old V5 holder balances. The old token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C` is used only as the exact identity/provenance anchor.

The final curve buy accepts only the gross amount needed to land on exactly 2 ETH net reserve. Excess is refunded or remains a payer-owned claim. Pending refunds, forced assets, and adapter seed dust are excluded from migration liquidity and fee splitting.

## Governance and creator-payout boundary

- V6 deploys fresh governance with operator `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA` as sole initial signer, threshold 1, immutable 24-hour delay, immutable seven-day execution window, cancellation, expiry, a public transaction getter, expiring proof-of-control acceptance bound to the current epoch, exact add-or-replace action, affected signer, and next threshold for every prospective added/replacement signer, candidate-controlled revocation of unconsumed consent before execution, atomic signer/threshold add-remove-replace operations, no multi-signer 1-of-N, and configuration-epoch invalidation of older proposals and unused acceptances. The same contract is the immutable protocol treasury and governs a fresh registry initialized to the legacy V5 factory/version. V6 has no dependency on legacy governance or the old registry.
- Adding the first extra wallet creates 2-of-2 governance, not a backup wallet; both signers are required afterward. Loss of the sole initial signer freezes treasury and protocol control, while compromise can authorize calls after the delay. In 2-of-2 mode, loss of either signer freezes governance.
- A token creator cannot authorize, propose, choose, or directly change the creator-fee payout wallet.
- The RMT signer can propose moving future creator-fee payments only to the immutable V6 governance treasury, or restoring them to the immutable original creator.
- Every payout proposal includes a public evidence hash plus the current replay-protection nonce. After the delay, any account may relay the exact approved call but cannot change its recipient or receive funds.
- Because the immutable treasury is the governance contract, invalidating a stale unexecuted payout nonce also requires an approved governance call.
- Already paid or deferred creator rewards remain owned by the wallet that earned them.
- Uncollected V4 fees use the creator recipient active when collection occurs; the timing boundary is collection, not accrual.
- Governance cannot redirect a creator's 70% fee share to an unrelated wallet and cannot withdraw curve reserves or locked V4 liquidity.

## Fail-closed preflight

Before the first deployment transaction, the recovery-aware browser console must verify the following. The fork-rehearsal-only Foundry script must assert the same starting state:

- [ ] Chain ID is exactly `4663`.
- [ ] Legacy V5 identity factory, exact official legacy RMT token, PoolManager, and CREATE2 deployer all have bytecode.
- [ ] The deployment wallet is exactly `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`.
- [ ] V5 reports `Robinhood Meme Terminal` and `RMT` as reserved.
- [ ] The exact legacy token reports creator `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`, name `Robinhood Meme Terminal`, and symbol `RMT`.
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

- [ ] Deploy the new V6 governance/treasury, fresh V6-governed version registry initialized to the V5 factory/version, hook, adapter, paused launch gate, V6 market implementation, component-locked policy registry, and V6 factory in the reviewed order.
- [ ] Confirm all deployed addresses have bytecode.
- [ ] Verify hook flags and the permanent hook/adapter/factory bindings.
- [ ] Verify the PoolManager, pool fee, tick spacing, governance, guardian, delays, governance-as-treasury, fresh-registry owner/initial state, virtual reserves, and legacy V5 identity dependency.
- [ ] Verify the policy registry's immutable canonical market and graduation-adapter getters match the reviewed deployed addresses and reject substitutions.
- [ ] Verify the factory derives creator-payout authority from the shared governance used by the gate and policy registry.
- [ ] Verify the one-time official RMT migration is authorized only for the operator, has not been consumed, and both factory and helper are permanently bound to legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C` with the expected creator/name/ticker.
- [ ] Verify the factory refuses all launches until it is active in the version registry.
- [ ] Verify the factory refuses every ordinary launch until the exact official RMT migration has succeeded, even if the launch gate is accidentally opened early.
- [ ] Verify V6 remains paused and V5 remains the active factory in the fresh V6 registry.
- [ ] After the V6 factory receipt confirms, set production `NEXT_PUBLIC_VERSION_REGISTRY_ADDRESS` to the fresh registry, `NEXT_PUBLIC_FACTORY_START_BLOCK` to that exact receipt block, and `NEXT_PUBLIC_APP_URL` to the exact public HTTPS origin; redeploy before V6 activation.
- [ ] Confirm the deployment phase created zero governance proposals.
- [ ] Run the twelve-contract source-verification script and then pass the console's live exact-source gate before submitting any proposal.
- [ ] Confirm the one V6 governance contract has zero proposals before the first proposal; afterward, account for every ID—including registry activation—from exact receipts and inspect every proposal's epoch, cancellation, expiry, approval, and execution state through its public getter.
- [ ] Read every governance proposal ID from its confirmed `Proposed` receipt event; never infer it from a local counter.
- [ ] Execute the delayed Fair-policy, Open-policy, default-policy, and registry phases only after each on-chain delay expires. Do not propose reopening yet.
- [ ] Activate `RMT_FACTORY_V6` only after policy hashes, source verification, and deployment bindings match the reviewed candidate.
- [ ] Keep the V6 launch gate paused throughout activation and production integration checks.
- [ ] Before signing, disclose and acknowledge that the official V6 launch creates a new token contract/address and new one-billion-token supply and does not copy, swap, credit, or migrate old V5 holder balances; then launch and verify it while ordinary public launches remain paused and confirm the gate stays paused.
- [ ] Only after the official migration is verified, propose reopening through delayed governance and record the confirmed proposal ID.

## Final go-live gate

- [ ] Publish verified V6 source, addresses, transaction hashes, deployment block, immutable parameters, known limitations, and independent review report.
- [ ] Confirm the terminal and indexer use V6 capability and policy metadata and do not present legacy launches as V6 launches.
- [ ] Confirm price, market cap, volume, holder, and chart units are correct on desktop and mobile.
- [ ] Complete the exact official RMT launch while paused and verify its new address, new supply, launch record, market, splitter, policy, no-balance-migration disclosure, and unchanged gate state.
- [ ] Complete the full buy, sell, claim, graduation, post-graduation swap, and permissionless fee-collection rehearsal on the exact mainnet fork; after reopening, run only the separately approved bounded disposable live smoke transaction set.
- [ ] Verify the current creator-share recipient receives exactly 70% and the protocol treasury receives exactly 30% of realized pre- and post-graduation fees.
- [ ] Verify neither the collector, creator, operator, governance, adapter, nor hook can remove locked liquidity principal.
- [ ] Verify monitoring, incident response, RPC fallbacks, and operator contacts are active.
- [ ] Verify the browser, server feed, health checks, and indexer use restricted production-capable RPC endpoints with provider-side rate and spend limits; do not rely on the rate-limited public RPC for launch traffic.
- [ ] Verify live production `/api/health` returns HTTP 200 and exposes the exact fresh registry, active V6 factory/version, and confirmed factory deployment start block with all configuration-validity flags true.
- [ ] Obtain explicit manual approval for CI, artifact review, independent audit, monitoring, and operator readiness; these cannot be proven by the console.
- [ ] After the full reopening delay, require the console's fresh binding, policy, official-launch, single-governance history, twelve-source, and exact live production-health checks, then execute reopening and re-run production health checks.

Public token creation remains closed until every required item above is complete.
