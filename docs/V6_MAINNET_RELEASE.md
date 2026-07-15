# RMT V6 mainnet release

Status: **draft release candidate — not deployed, active, or open**

This is the operator handoff for the policy-driven V6 release. Completing tests does not authorize a deployment. Deployment does not authorize activation. Activation does not authorize reopening launches.

## Current mainnet dependencies

- [Existing V5 registry governance](https://robinhoodchain.blockscout.com/address/0x13c0a930516fb6bf0d467b38605d9d2a9c4c6953) — retained only because it is the immutable authority of the existing version registry. It submits the single reviewed V6 factory-activation proposal and receives no new V6 gate, policy, or payout role.
- [Active V5 factory](https://robinhoodchain.blockscout.com/address/0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd) — remains active until the complete V6 candidate is ready
- [Version registry](https://robinhoodchain.blockscout.com/address/0x4b8b222b5caa7066c02a54e51ec1a674adf5b3a1) — 48-hour factory activation delay
- [Official legacy RMT token](https://robinhoodchain.blockscout.com/token/0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C) — unchanged and used as the immutable provenance anchor for the one-time migration. The V6 factory constructor requires bytecode at this exact address and verifies its creator, name, and ticker before deployment can succeed.
- [Canonical Uniswap V4 PoolManager](https://robinhoodchain.blockscout.com/address/0x8366a39cc670b4001a1121b8f6a443a643e40951)

The final V6 addresses and transaction hashes must be added here only after receipts and deployed bytecode are independently verified.

V6 deploys a fresh `RMTV6Governance` with RMTMain as the sole initial signer and threshold 1, an immutable 24-hour delay, and an immutable seven-day execution window. Any current signer may cancel a pending proposal. Pending proposals expire, every proposal is fully inspectable, and atomic add/remove/replace-and-threshold operations advance a configuration epoch that invalidates every older pending proposal and confirmation. A prospective added or replacement signer must first prove control and call `acceptSignerRole` with the current configuration epoch, exact add-or-replace action, affected signer, next threshold, and an expiration no later than one full governance cycle. The candidate can revoke that consent before execution, execution consumes it, expiration makes it unusable, and an epoch change makes it stale. Generic execution is permissionless only for current-epoch, fully approved, uncancelled, unexpired proposals; a relayer cannot alter any approved call field and receives no role or reward. Cancellation is guaranteed before the execution delay matures; once both cancellation and execution are valid, transaction ordering decides which is mined first and a completed call cannot be undone. A multi-signer configuration cannot be 1-of-N. Adding the first extra wallet therefore creates 2-of-2 governance, not a backup wallet, and both signers must remain available.

The [official Uniswap V4 deployment list](https://developers.uniswap.org/docs/protocols/v4/deployments) identifies this PoolManager for Robinhood Chain. The release still requires nonempty bytecode from the exact production RPC used for the fork rehearsal and broadcast. If an explorer, RPC, or published list disagrees, stop; do not bypass the live-code preflight.

## Immutable launch economics

- Fixed supply: 1,000,000,000 tokens
- Initial virtual native reserve: 0.3 ETH
- Initial virtual token reserve: 1,017,500,000 tokens
- Graduation target: 2 ETH net real reserve
- Bonding-curve fee: 1%
- Creator share of fees: 70%
- Protocol share of fees: 30%
- Post-graduation V4 pool fee: 0.5%
- Graduation liquidity: full range, principal permanently locked, no removal function

Both bonding-curve fees and collected V4 position fees use the launch's immutable 70/30 splitter. Each splitter accounts explicit deposits only from its bound market or graduation adapter, and the V4 hook rejects outside liquidity and permissionless donations; arbitrary transfers cannot inflate reported fee totals. The V6 policy registry constructor permanently records the one reviewed market implementation and graduation adapter, and every policy must use those exact addresses as well as the canonical fee percentages, split, graduation target, and RMT treasury. V4 fees can be collected by anyone, but the caller cannot choose the destination.

The splitter carries sub-unit rounding independently for each fee asset and creator-share recipient. As a result, splitting a trade or permissionless collection into many tiny deposits cannot bias the cumulative 70/30 distribution. A payout redirect does not transfer the prior recipient's fractional carry; if governance later restores that recipient, their carry resumes with them.

Creators cannot initiate, accept, or execute a payout-wallet change. Delayed RMT governance may move future creator-fee payments only to the immutable RMT treasury, or restore them to the immutable original creator. Every change includes a public evidence hash and the current replay-protection nonce. The immutable RMT treasury can invalidate a stale unexecuted nonce but cannot select a recipient. Previously paid or deferred ETH/token rewards remain owned by the wallet that earned them, and governance cannot redirect the creator share to any unrelated wallet.

The payout boundary is fee collection, not fee accrual. Fees collected before an accepted redirect use the old recipient; uncollected fees realized afterward use the new recipient. After graduation, the current creator-share recipient receives only 70% of collected LP swap fees in the asset charged by the pool—ETH and/or the launched token. By default that recipient is the immutable original creator. This is not a token allocation, liquidity ownership, or a claim on principal. RMT receives the remaining 30% from the canonical RMT pool; independent external pools are outside this mechanism. If the canonical PoolManager enables a separate protocol fee, Uniswap removes it upstream and the splitter divides only the remaining LP fees actually collected.

For the one-time official V6 RMT launch only, the immutable original creator and the protocol treasury are the same verified RMTMain wallet. That wallet therefore receives the ordinary 70% creator share and ordinary 30% protocol share, or 100% in aggregate, without any additional fee, token allocation, or double accounting. This does not change the rule for any other launch: an ordinary creator receives exactly 70% and RMT receives exactly 30%.

The final curve buy is clamped to exactly 2 ETH of net reserve. Excess payment is returned immediately or kept as a payer-owned refund claim if delivery fails. Pending refunds, forced ETH, unsolicited tokens, and adapter seed-settlement dust never enter graduation liquidity or fee distribution.

## Fair Start

The website exposes one toggle backed by two immutable policies:

- Fair: one-block opening delay, ten protected blocks, maximum 1% of supply per buy, maximum 3% per wallet, one buy per wallet per block, recipient must equal buyer
- Open: the same economics without the opening restrictions

Fair is the default. These limits end automatically after the protected window. They do not impose a permanent wallet cap.

## Release sequence

1. Freeze the reviewed commit, regenerate the wallet deployment artifact from that exact final compile, and require the artifact-producing CI run to finish green. The generated V6 governance ABI must contain `acceptSignerRole(uint64,uint8,address,uint256,uint64)` and `revokeSignerRoleAcceptance(uint64)`; both the exporter and wallet console fail closed when either is absent. Never use a stale generated artifact.
2. Complete independent contract and deployment review against that exact commit and bytecode.
3. Run the fail-closed live preflight. It must confirm the existing V5 registry governance still has RMTMain as sole signer, threshold `1`, a 24-hour delay, and `transactionCount()` zero; the registry uses that exact legacy authority, has a 48-hour delay, has V5 active, and has no pending proposal; V5 reports the official RMT name and ticker as protected; and the exact legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C` has code and reports RMTMain, `Robinhood Meme Terminal`, and `RMT`. A nonzero legacy-governance count or provenance mismatch is a stop condition until reconciled.
4. Use only the recovery-aware operator console to deploy the new V6 governance, hook, 0.5% adapter, paused launch gate, market implementation, component-locked policy registry, and V6 factory. The new governance must have the exact one-wallet, 24-hour delay, seven-day window, epoch-1, zero-proposal configuration. The gate, policy registry, factory creator-payout authority, and every launch splitter must use it. The existing V5 governance remains only on the existing version registry. This phase deploys and binds only; it creates zero governance proposals. `DeployMainnetV6OfficialMigration.s.sol` is restricted to the exact mainnet-fork rehearsal and rejects a production run.
5. Run the fail-closed V6 source-verification gate below. It verifies bytecode, hook flags, adapter/factory bindings, both governance boundaries, guardian, legacy identity factory, exact official legacy token provenance, fees, reserves, delays, official-migration authority, and paused state before submitting the ten V6 contracts plus the V5 registry governance, version registry, and V5 identity factory to Blockscout. The existing legacy token is checked as an immutable dependency, not counted as newly deployed V6 source.
6. Submit Fair and Open policy-registration proposals through the new V6 governance, and submit only the factory-activation proposal through the existing V5 registry governance. Proposal IDs must come from confirmed `Proposed` events, never a guessed counter.
7. After the governance delay, execute those proposals. This starts the policy-registry and factory-registry delays.
8. After the policy delay, register both immutable policies and submit the delayed default-policy proposal.
9. After governance and policy delays, set Fair as default.
10. After the registry delay, activate V6. Confirm the V6 launch gate is still paused. The factory itself must continue rejecting every ordinary launch until the exact official migration is consumed.
11. Confirm the production site resolves only the active V6 factory and still blocks ordinary creation.
12. From the verified operator wallet, use the exact one-time paused official migration to launch `Robinhood Meme Terminal` / `RMT` under the Fair policy. Confirm the public gate remains paused and verify the launch record, token supply, splitter, market, adapter, and policy.
13. Submit and execute the delayed reopening proposal, then wait the launch-gate delay.
14. Re-run production health, wallet, RPC, indexer, mobile, buy/sell, and monitoring checks.
15. From the reviewed RMTMain guardian wallet, run the console's final live checks and finalize the already governance-authorized reopening. The gate rejects every outsider even after the delay. Then complete a bounded smoke launch/trade with a disposable non-official token.

Every browser phase is resumable. A rejected wallet request leaves completed steps recorded, and recovery adopts only exact reviewed onchain events for permissionlessly finalized governance, policy, and registry steps. No browser phase requests a private key or recovery phrase. The console does not trust its recovery file or local-storage source marker at a governance boundary: it revalidates confirmed receipts, exact bindings, all thirteen current Blockscout records, and both complete governance proposal-ID sets before submitting proposals. Every V6 proposal is also checked through the public transaction getter for its epoch, cancellation, expiry, approvals, and execution status. The legacy registry-governance proposal is accepted only as the one exact V6 activation call, and every ID from zero through its `transactionCount() - 1` must be proven by an exact saved `Proposed` receipt. The final reopening action repeats the binding, policy, official-migration, delay, governance-history, and source checks immediately before the operator-authorized unpause transaction; the launch gate itself rejects outsider execution.

The console cannot prove that CI, the generated artifact review, an independent audit, monitoring, or operator readiness are complete. Those remain explicit manual release approvals. A passing console check never replaces them.

### Post-deployment Blockscout verification

Run this immediately after the seven V6 addresses have confirmed deployment receipts and before submitting any delayed governance proposal:

```bash
cd packages/contracts
V6_GOVERNANCE_ADDRESS=0x... \
V6_HOOK_ADDRESS=0x... \
V6_ADAPTER_ADDRESS=0x... \
V6_LAUNCH_GATE_ADDRESS=0x... \
V6_POLICY_REGISTRY_ADDRESS=0x... \
V6_MARKET_IMPLEMENTATION_ADDRESS=0x... \
V6_FACTORY_ADDRESS=0x... \
bash scripts/verify-mainnet-v6.sh
```

The script requires all seven operator-recorded addresses, derives the token implementation, fee-splitter implementation, and official-identity migration from the factory, and verifies thirteen contracts: the ten V6 contracts plus the existing V5 registry governance, the version registry, and the V5 identity factory. It validates the new V6 governance's signer, threshold, delay, execution window, epoch, and zero initial proposal count, and separately validates the legacy registry-governance boundary. The policy-registry verification input encodes the exact market and adapter addresses in its constructor arguments and checks both live immutable getters before source submission. The script uses the canonical Robinhood mainnet RPC and Blockscout endpoint unless `ROBINHOOD_MAINNET_RPC_URL` or `BLOCKSCOUT_VERIFIER_URL` is explicitly supplied. It never broadcasts a blockchain transaction and accepts no private key, mnemonic, activation, or unpause input; it does submit source-verification requests to Blockscout. Any chain, code, binding, getter, governance-history, or pre-activation state mismatch stops the run. After it succeeds, return to the operator console: its source-verification phase checks each address through Blockscout's live smart-contract API and requires the expected contract name and compilation target, full—not partial—verification, unchanged bytecode, exact Solidity `v0.8.26+commit.8a97fa7a`, via-IR, and the reviewed optimizer settings. Proposal submission repeats that live check.

For a button-driven run, open the repository's **Verify V6 mainnet sources** GitHub workflow on the frozen release commit and enter the same seven addresses. The workflow runs this exact script without signing material and archives the commit SHA and full log. A workflow run from another commit is not valid release evidence.

The Foundry script is rehearsal-only and intentionally has no production broadcast or proposal path. Production foundation deployment and every later governance phase use the resumable operator console after the source-verification script and live Blockscout gate have passed.

## Required evidence before reopening

- Final CI, Slither, web, indexer, and V6 mainnet-fork runs are green
- Independent review references the exact commit and compiled bytecode
- V6 source verification is complete for every deployed component
- Deployed addresses and transaction hashes are published
- Active registry version is `RMT_FACTORY_V6`
- Pre-deployment live dependency assertions passed against the same block used for the release rehearsal
- Default Fair and optional Open policies match the published economics hashes
- Launch gate is paused until the last approved step
- Official RMT V6 migration is bound to legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C`, succeeds once while ordinary launches remain paused, and records the exact old-to-new relationship
- Production terminal reads only V6 launch events for the new feed
- Mobile Safari, injected wallets, WalletConnect, and mobile deep links pass
- Browser, server, and indexer traffic use restricted production-capable RPC endpoints with provider-side rate and spend limits; the rate-limited public RPC is not the production traffic path
- Monitoring and incident-response contacts are active

## Explicitly not included in V6

Wallet-based Firebase accounts, external launchpad aggregation, recovery/CTO rules, creator reputation, and V7+ features remain frozen until V6 is deployed, the official RMT V6 token launches successfully while public creation is paused, public launches are reopened, and production is stable.
