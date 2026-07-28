# RMT V6 mainnet release

Current production status: **V6 is deployed and active for existing-market trading; new launches are intentionally paused while V7 is designed**

The live addresses and transaction receipts are recorded in [MAINNET_V6_DEPLOYMENT.md](MAINNET_V6_DEPLOYMENT.md). The remainder of this document is the historical release and recovery plan, not proof that every planned gate was completed; future operators must not read its pre-deployment language or source-verification requirements as the current production state.

This is the operator handoff for the policy-driven V6 release. Deployment, activation, the official RMT launch, and public reopening remain separate wallet-confirmed boundaries.

## Current mainnet dependencies

- [Legacy V5 identity factory](https://robinhoodchain.blockscout.com/address/0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd) — retained only as the legacy identity source and the initial factory recorded in the fresh V6 registry
- [Official legacy RMT token](https://robinhoodchain.blockscout.com/token/0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C) — unchanged and used only as the immutable provenance anchor for the one-time V6 launch. The V6 factory constructor requires bytecode at this exact address and verifies its creator, name, and ticker before deployment can succeed.
- [Canonical Uniswap V4 PoolManager](https://robinhoodchain.blockscout.com/address/0x8366a39cc670b4001a1121b8f6a443a643e40951)

The reconstructed top-level V6 foundation addresses and creation/binding receipts are published in the canonical deployment record linked above. That record also identifies the derived-contract, activation, opening, official-launch, and splitter evidence still missing from the public inventory.

V6 deploys a fresh `RMTV6Governance` that is both protocol authority and protocol treasury, plus a fresh `VersionedFactoryRegistry` governed by it and initialized to the legacy V5 factory and `RMT_FACTORY_V5`. V6 has no governance or registry dependency on the legacy V5 stack. RMTMain is the sole initial signer with threshold 1, an immutable 24-hour delay, and an immutable seven-day execution window. Any current signer may cancel a pending proposal. Pending proposals expire, every proposal is fully inspectable, and atomic add/remove/replace-and-threshold operations advance a configuration epoch that invalidates every older pending proposal, confirmation, and downstream registry/gate/policy schedule. Each downstream schedule is bound to the live epoch and expires seven days after its own delay matures. A prospective added or replacement signer must first prove control and call `acceptSignerRole` with the current configuration epoch, exact add-or-replace action, affected signer, next threshold, and an expiration no later than one full governance cycle. The candidate can revoke that consent before execution, execution consumes it, expiration makes it unusable, and an epoch change makes it stale. Generic execution is permissionless only for current-epoch, fully approved, uncancelled, unexpired proposals; a relayer cannot alter any approved call field and receives no role or reward. Cancellation is guaranteed before the execution delay matures; once both cancellation and execution are valid, transaction ordering decides which is mined first and a completed call cannot be undone. A multi-signer configuration cannot be 1-of-N. Adding the first extra wallet therefore creates 2-of-2 governance, not a backup wallet, and both signers must remain available. The launch and policy guardians begin as RMTMain but may be rotated only by this delayed governance; signer rotation does not rotate either guardian automatically. Losing the sole initial key freezes treasury and protocol control; compromise can authorize treasury/control calls after the delay. In 2-of-2 mode, losing either signer freezes governance.

The official V6 “migration” does not transfer ERC-20 state. It creates a new token contract with a new address and a new fixed supply of 1,000,000,000 tokens. No old V5 holder balance is copied, swapped, credited, or migrated. The old token address is used only to prove the exact RMT creator/name/ticker provenance before the new launch.

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

Creators cannot authorize, propose, choose, or directly change a payout wallet. The RMT signer may propose moving future creator-fee payments only to the immutable V6 governance treasury, or restoring them to the immutable original creator. Every proposal includes a public evidence hash and the current replay-protection nonce. After the 24-hour delay, any account may relay the exact approved governance call; the relayer cannot alter the recipient or receive funds. Because the treasury is the governance contract, invalidating a stale nonce also requires an approved governance call. Previously paid or deferred ETH/token rewards remain owned by the wallet that earned them, and governance cannot redirect the creator share to any unrelated wallet.

The payout boundary is fee collection, not fee accrual. Fees collected before an accepted redirect use the old recipient; uncollected fees realized afterward use the new recipient. After graduation, the current creator-share recipient receives only 70% of collected LP swap fees in the asset charged by the pool—ETH and/or the launched token. By default that recipient is the immutable original creator. This is not a token allocation, liquidity ownership, or a claim on principal. RMT receives the remaining 30% from the canonical RMT pool; independent external pools are outside this mechanism. If the canonical PoolManager enables a separate protocol fee, Uniswap removes it upstream and the splitter divides only the remaining LP fees actually collected.

For the one-time official V6 RMT launch, the verified RMTMain operator is the immutable original creator and receives the ordinary 70% creator share. The separate V6 governance contract is the protocol treasury and receives the ordinary 30% protocol share. The official launch is not a same-wallet 100% payout and receives no additional fee, token allocation, or duplicate accounting.

The final curve buy is clamped to exactly 2 ETH of net reserve. Excess payment is returned immediately or kept as a payer-owned refund claim if delivery fails. Pending refunds, forced ETH, unsolicited tokens, and adapter seed-settlement dust never enter graduation liquidity or fee distribution.

## Fair Start

The website exposes one toggle backed by two immutable policies:

- Fair: one-block opening delay, ten protected blocks, maximum 1% of supply per buy, maximum 3% per wallet, one buy per wallet per block, recipient must equal buyer
- Open: the same economics without the opening restrictions

Fair is the default. These limits end automatically after the protected window. They do not impose a permanent wallet cap.

## Release sequence

1. Freeze the release commit, regenerate the wallet deployment artifact from that exact compile, and require CI, security analysis, web, indexer, artifact-equality, and mainnet-fork jobs to finish green. Never use a stale generated artifact.
2. Run the live dependency preflight. It must prove bytecode at the legacy V5 identity factory, exact legacy RMT token, PoolManager, and CREATE2 deployer; the V5 factory must reserve the official name and ticker; and the exact legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C` must report RMTMain, `Robinhood Meme Terminal`, and `RMT`.
3. Use only the recovery-aware operator console to deploy the V6 governance/treasury, the expiring bootstrap controller, fresh registry initialized to V5, hook, 0.5% adapter, paused gate, market implementation, policy registry, and V6 factory. The controller creates and permanently binds its two read-only verifier children. The policy-registry constructor installs only the exact Fair and Open V1 policies and makes Fair the default. Governance must remain epoch 1 with RMTMain as its only signer, threshold 1, a 24-hour delay, a seven-day window, and zero proposals.
4. Immediately run and archive the fail-closed source verifier below. It checks the nine operator-recorded contracts, derives the controller's two verifier children and the factory's three created implementations/helpers, and requires all fourteen V6 contracts plus the V5 identity factory—fifteen records total—to be fully verified on Blockscout with the exact compiler settings.
5. Before the controller's fixed 12-hour window expires, use the console to recheck all fifteen live explorer records and atomically activate only the exact verified V6 factory. Public launches remain paused. The registry's normal 48-hour activation delay is unchanged for every later factory version.
6. Apply the production cutover configuration below and redeploy the site. The console must prove the live production `/api/health` response resolves the exact fresh registry, active V6 factory/version, and confirmed factory deployment block while launches remain paused.
7. From RMTMain, launch exactly one new `Robinhood Meme Terminal` / `RMT` token through `launchOfficialWhilePaused`. This creates a new address and new one-billion-token supply; it does not copy, swap, credit, or migrate V5 balances. Record and publish the new CA. Ordinary token creation remains blocked.
8. Wait the one Fair Start block, then make one small RMT buy. Confirm the buy succeeds while the market remains below graduation, the real and virtual reserves move consistently, the splitter reports nonzero native curve fees, all reported fees are paid, the creator receives 70%, governance receives 30%, and neither recipient has a pending payout. Direct or forced ETH, a graduated market, or later adapter fees cannot satisfy this check.
9. Return to the console. It repeats the source, receipt, topology, policy, migration, real-fee, and live production-health checks, then calls the controller's one-time final opening. The controller, registry, gate, and identity migration each have independent replay latches. Completion permanently removes the expedited path.
10. Confirm public creation from a second wallet by launching a separate non-official token, then perform bounded buy and sell checks on desktop and mobile. Publish the V6 addresses, transaction hashes, official RMT CA, and explicit unaudited-beta disclosure before declaring the release live.

The 12-hour controller and its two immutable read-only verifier children are not a second governance authority, upgrade path, treasury role, generic executor, or reusable admin shortcut. They accept no assets and cannot change policies, fees, recipients, signers, or arbitrary contracts. The controller works only on chain 4663, only for the exact RMTMain operator, only while governance has zero proposals, and only across the `Unbound → OfficialPending → Complete` release state. It may be aborted or permissionlessly expired, but never reset. If it expires or aborts, the stack remains paused and the normal delayed governance paths remain available.

The 12-hour bootstrap window is a completion deadline, not a waiting period. Genesis deployment, source checks, V6 activation, official RMT launch, the one-block Fair Start wait, one genuine fee-producing buy, and public opening may all finish in the same operator session. The 24-hour governance, 24-hour reopening, and 48-hour registry delays apply only to later changes or recovery after the one-time bootstrap is consumed or lost.

Every browser phase is resumable. A rejected wallet request leaves completed receipts recorded. Recovery files contain public addresses and transaction hashes only, and every continuation rechecks those receipts and the current onchain topology. The final opening repeats live source and production health checks instead of trusting a prior browser flag.

V6 is an explicitly disclosed unaudited mainnet beta. Automated tests, Slither, and the controller's onchain checks reduce some classes of risk but do not replace an independent human audit. The historical release plan required exact source publication, but current Blockscout records do not establish that requirement; canonical source/bytecode reconstruction and an independent audit remain post-launch priorities once protocol funds permit them.

### Historical production-site registry cutover

The current production site may keep reading the checked-in V5 registry and V5 deployment history while the V6 foundation does not exist. After the fresh V6 registry and V6 factory are deployed, do not activate or reopen against that fallback. Set the following production environment values and redeploy the site:

```dotenv
NEXT_PUBLIC_RMT_NETWORK=mainnet
NEXT_PUBLIC_VERSION_REGISTRY_ADDRESS=<fresh V6-governed registry address>
NEXT_PUBLIC_FACTORY_START_BLOCK=<exact block from the confirmed V6 factory deployment receipt>
NEXT_PUBLIC_APP_URL=https://www.rmtlaunch.fun
```

The registry and block are public routing evidence, not secrets. Keep the browser and server RPC settings separate and provider-restricted as described in `.env.example`. While the fresh registry still reports V5, the read-only V5 feed remains available from its known V5 start block. Once `RMT_FACTORY_V6` becomes active, the feed reads only `TokenLaunchedV6` from the explicitly configured V6 start block; an unknown version or missing/malformed cutover value returns no launch feed and degrades health.

The live production `GET /api/health` response publishes `releaseEvidence.registryAddress`, `factoryAddress`, `factoryVersion`, and `factoryStartBlock`, together with explicit-configuration validity flags. Before the final unpause transaction, the operator console requires an HTTP 200 healthy report from the exact HTTPS origin in `NEXT_PUBLIC_APP_URL`, requires every health check to be operational, and compares those four values to the fresh registry in the recovery record, active `RMT_FACTORY_V6`, and the confirmed V6 factory receipt block. A local build, preview deployment, legacy registry, stale factory, wrong start block, unhealthy report, or stale report cannot reopen launches.

### Post-deployment Blockscout verification

Run this immediately after the nine V6 addresses have confirmed deployment receipts and before one-time activation:

```bash
cd packages/contracts
V6_GOVERNANCE_ADDRESS=0x... \
V6_BOOTSTRAP_CONTROLLER_ADDRESS=0x... \
V6_VERSION_REGISTRY_ADDRESS=0x... \
V6_HOOK_ADDRESS=0x... \
V6_ADAPTER_ADDRESS=0x... \
V6_LAUNCH_GATE_ADDRESS=0x... \
V6_POLICY_REGISTRY_ADDRESS=0x... \
V6_MARKET_IMPLEMENTATION_ADDRESS=0x... \
V6_FACTORY_ADDRESS=0x... \
bash scripts/verify-mainnet-v6.sh
```

The script requires all nine operator-recorded addresses, derives the controller's foundation and smoke verifier children plus the factory's token implementation, fee-splitter implementation, and official-identity migration, and verifies fifteen contracts: fourteen V6 contracts plus the V5 identity factory. It validates the V6 governance/treasury signer, threshold, delay, execution window, epoch, and zero initial proposal count; the controller and both verifiers' chain, operator, expiry, topology, bindings, and unused state; and the fresh registry's V5 starting point and empty pending state. The policy-registry verification input encodes the exact governance treasury, market, and adapter addresses and checks both constructor-installed policies and the Fair default before source submission. The script uses the canonical Robinhood mainnet RPC and Blockscout endpoint unless `ROBINHOOD_MAINNET_RPC_URL` or `BLOCKSCOUT_VERIFIER_URL` is explicitly supplied. It never broadcasts a blockchain transaction and accepts no private key, mnemonic, activation, or unpause input; it does submit source-verification requests to Blockscout. Any chain, code, binding, getter, governance-history, expiry, or pre-activation mismatch stops the run. After it succeeds, return to the operator console: its source-verification phase checks every address through Blockscout's live smart-contract API and requires the expected contract name and compilation target, full—not partial—verification, unchanged bytecode, exact Solidity `v0.8.26+commit.8a97fa7a`, via-IR, and the reviewed optimizer settings.

For a button-driven run, open the repository's **Verify V6 mainnet sources** GitHub workflow on the frozen release commit and enter the same nine addresses. The workflow runs this exact script without signing material and archives the commit SHA and full log. A workflow run from another commit is not valid release evidence.

The Foundry script is rehearsal-only and intentionally has no production broadcast or proposal path. Production foundation deployment and every later governance phase use the resumable operator console after the source-verification script and live Blockscout gate have passed.

## Required evidence before reopening

- Final CI, Slither, web, indexer, and V6 mainnet-fork runs are green
- Explicit unaudited-mainnet-beta disclosure is visible, with an independent audit retained as the first funded post-launch security priority
- V6 source verification is complete for every deployed component
- Deployed addresses and transaction hashes are published
- Active registry version is `RMT_FACTORY_V6`
- Production `NEXT_PUBLIC_VERSION_REGISTRY_ADDRESS` equals the fresh V6-governed registry, `NEXT_PUBLIC_FACTORY_START_BLOCK` equals the confirmed V6 factory deployment block, and live `/api/health` reports the same registry/factory/version/start-block evidence as healthy
- Pre-deployment live dependency assertions passed against the same block used for the release rehearsal
- Default Fair and optional Open policies match the published economics hashes
- Launch gate is paused until the last approved step
- Official RMT V6 launch is bound to legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C`, succeeds once while ordinary launches remain paused, and records the exact old-to-new provenance relationship; the published disclosure states that the new contract/supply does not copy, swap, credit, or migrate old holder balances
- Production terminal reads only V6 launch events for the new feed
- Mobile Safari with Robinhood Wallet over WalletConnect, the MetaMask mobile deep link, and compatible injected wallet browsers pass; unverified wallet brands are not advertised
- Browser, server, and indexer traffic use restricted production-capable RPC endpoints with provider-side rate and spend limits; the rate-limited public RPC is not the production traffic path
- Monitoring and incident-response contacts are active

## Explicitly not included in V6

Wallet-based Firebase accounts, external launchpad aggregation, recovery/CTO rules, creator reputation, and V7+ features remain frozen until V6 is deployed, the official RMT V6 token launches successfully while public creation is paused, public launches are reopened, and production is stable.
