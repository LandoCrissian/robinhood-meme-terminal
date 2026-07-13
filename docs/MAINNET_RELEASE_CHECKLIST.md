# Robinhood Meme Terminal mainnet release checklist

This document separates a **release candidate** from a **mainnet broadcast**. Passing CI does not make unaudited smart contracts risk-free, and no automated review can guarantee that a contract has no exploitable defect.

## Canonical infrastructure

- Robinhood Chain mainnet chain ID: `4663`
- Gas asset: ETH
- Official public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Canonical Uniswap V4 PoolManager: `0x8366a39cC670b4001A1121b8F6A443A643E40951`
- Canonical CREATE2 deployer: `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- Production deployments should use a dedicated, production-capable RPC rather than relying on the rate-limited public endpoint.

Sources:

- https://docs.robinhood.com/chain/connecting/
- https://developers.uniswap.org/docs/protocols/v4/deployments

## Reviewed release parameters

These values are immutable in the release candidate and must be approved before broadcast:

| Parameter | Value |
| --- | ---: |
| Curve trading fee | 1% |
| Uniswap V4 pool fee after graduation | 1% |
| Initial virtual ETH reserve | 0.3 ETH |
| Initial virtual token reserve | 1.073 billion tokens |
| Fixed token supply | 1 billion tokens |
| Graduation reserve target | 1 ETH |
| Simple launch fee distribution | 70% creator / 30% protocol |
| Community launch fee distribution | 40% creator / 20% community / 10% trader incentives / 30% protocol |
| Protocol share distribution | 40% treasury / 20% buyback reserve / 20% graduation assistance / 10% referral reserve / 10% ecosystem growth |
| Factory version activation delay | 48 hours |
| Community/trader reward release delay | 24 hours |
| Protocol-purpose vault execution delay | 24 hours |
| Governance threshold | 2 of 3 independent signers |

Percentages distribute the 1% curve fee, not the full trade value. Graduation liquidity stays in each market's reserve and is separate from the protocol graduation-assistance fund.

## Automatic governance and purpose vaults

The production deployment accepts exactly three independent signer addresses. It automatically creates:

- a 2-of-3 factory-governance wallet;
- a 2-of-3 rewards-governance wallet;
- a delayed 2-of-3 protocol-governance wallet;
- five immutable ETH-only purpose vaults for treasury, buyback reserve, graduation assistance, referral reserve, and ecosystem growth.

The five purpose vaults cannot make arbitrary calls and release ETH only to a specified recipient after their governance wallet approves the transaction. Protocol-purpose releases wait 24 hours after the second signer confirms. Factory and purpose-rewards administration use the same 2-of-3 signer set without exposing the protocol-purpose balances to an unsupported third-party multisig service.

Signer addresses are deployment inputs, not hardcoded secrets. Signer replacement requires a 2-of-3 governance transaction executed by the governance contract itself. A lost signer cannot rotate itself or take control alone.

## Security and future-version model

- Tokens, markets, reward vaults, and graduation bindings are not proxies and cannot be rewritten after launch.
- The factory and protocol revenue router have no owner, upgrade function, arbitrary-call function, recipient-change function, or emergency withdrawal bypass.
- Protocol revenue destinations are immutable and are the five automatically deployed purpose vaults.
- The factory deploys a purpose-only rewards controller with a fixed 24-hour release delay. Its separate 2-of-3 governance wallet can propose or cancel releases, but cannot touch tokens, markets, graduation liquidity, or protocol revenue.
- Future releases deploy a new factory. A 48-hour delayed registry proposal changes only the factory used for future launches.
- A registry update cannot alter existing tokens, markets, rewards, or liquidity.
- Fair Start is automatic: trading opens after 3 blocks, then protects the next 25 blocks with a 0.5% per-buy cap, 1.5% cumulative wallet cap, one buy per wallet per block, and recipient-equals-caller enforcement.
- Fair Start reduces common early-launch advantages; it is not a promise that bots, Sybil wallets, or MEV are impossible.
- The version registry is a discovery and upgrade-coordination tool, not an upgradeable proxy.
- Cross-version name and symbol reservations must be migrated or shared before any future factory is activated.

## Required before broadcast

- [ ] Confirm the exact source commit is green in CI.
- [ ] Complete a Robinhood mainnet fork deployment and smoke test against the canonical PoolManager.
- [ ] Review and approve every economic and Fair Start parameter above.
- [ ] Confirm all three signer wallets use independent recovery phrases and are controlled through separate wallet installations.
- [ ] Confirm the 2-of-3 threshold, 24-hour protocol-purpose delay, signer-rotation procedure, and recovery plan.
- [ ] Confirm the deployment automatically creates three governance contracts and five distinct purpose vaults.
- [ ] Fund a dedicated deployment wallet with only the ETH needed for deployment.
- [ ] Configure a production-capable mainnet RPC.
- [ ] Run an independent smart-contract security review. If deferred, do not describe the release as audited or safe.
- [ ] Complete static analysis, fuzz tests, invariants, malicious-recipient tests, reentrancy tests, graduation tests, governance tests, and mainnet-fork tests.
- [ ] Confirm the frontend remains testnet-only until the mainnet factory passes the smoke test.
- [ ] Confirm Blockscout verification commands and compiler settings.
- [ ] Record deployer, source commit, transaction hashes, deployment block, hook, adapter, router, factory, registry, all governance addresses, and all purpose-vault addresses.
- [ ] Publish immutable parameters and known limitations before public use.

## Broadcast procedure

From `packages/contracts`, export the required values locally. Never paste a private key into chat, source control, Vercel, or a screenshot.

Required operator values:

- `SIGNER_ONE`
- `SIGNER_TWO`
- `SIGNER_THREE`

The deployment shell refuses to run unless:

- the RPC reports chain `4663`;
- the canonical PoolManager and CREATE2 deployer have bytecode;
- all three signer addresses are valid, nonzero, and distinct;
- the deployment wallet has ETH;
- `MAINNET_DEPLOYMENT_CONFIRMED=YES_DEPLOY_ROBINHOOD_MAINNET` is explicitly set.

The deployment then creates and verifies the governance wallets, purpose vaults, protocol router, purpose-rewards controller, V4 launch stack, and delayed version registry. Run `scripts/deploy-mainnet.sh`, record its outputs, and then run `scripts/smoke-test-mainnet.sh`.

## Go-live gate

Do not point the public launcher at the mainnet registry/factory until the smoke test verifies:

- canonical PoolManager;
- permanent hook/adapter/factory bindings;
- V4 factory and all clone implementations;
- immutable protocol-router recipients and 40/20/20/10/10 accounting;
- three independent governance wallets with the expected signers, thresholds, and delays;
- five distinct purpose vaults with the expected immutable labels and governance;
- delayed factory registry, active version, and active factory;
- delayed purpose-rewards controller, separate governance, registered-vault enforcement, and 24-hour release delay;
- immutable fee and curve values;
- Fair Start delay, duration, and caps;
- absence of factory/router owner and proxy upgrade entrypoints;
- deployed bytecode at every protocol address.

After verification, perform one low-value disposable mainnet launch and a low-value buy/sell/claim/graduation cycle before launching the project token or opening public access.
