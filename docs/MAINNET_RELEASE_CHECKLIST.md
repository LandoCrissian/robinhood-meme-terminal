# Robinhood Meme Terminal mainnet release checklist

This document separates a **release candidate** from a **mainnet broadcast**. Passing CI does not make unaudited smart contracts risk-free.

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
| Simple launch fee distribution | 85% creator / 15% platform |
| Community launch fee distribution | 45% creator / 25% community / 15% trader rewards / 15% platform |

Percentages above distribute the 1% curve fee, not the full trade value. Graduation liquidity stays in the market reserve and is not a discretionary reward vault.

## Required before broadcast

- [ ] Confirm the exact source commit is green in CI.
- [ ] Complete a Robinhood mainnet fork test against the canonical PoolManager.
- [ ] Review and approve every economic parameter above.
- [ ] Provide a dedicated platform treasury address.
- [ ] Provide a rewards-controller address, preferably a separately controlled multisig.
- [ ] Fund a dedicated deployment wallet with only the ETH needed for deployment.
- [ ] Configure a production-capable mainnet RPC.
- [ ] Run an independent smart-contract security review. If this is deferred, record that risk publicly and apply conservative limits.
- [ ] Confirm the frontend remains testnet-only until the mainnet factory passes the smoke test.
- [ ] Confirm Blockscout verification commands and compiler settings.
- [ ] Record deployer, source commit, transaction hashes, deployment block, hook, adapter, factory, and treasury/controller addresses.

## Broadcast procedure

From `packages/contracts`, export the required values locally. Never paste a private key into chat, source control, Vercel, or a screenshot.

The deployment shell refuses to run unless:

- the RPC reports chain `4663`;
- the canonical PoolManager and CREATE2 deployer have bytecode;
- treasury and controller addresses are valid;
- the deployer has ETH;
- `MAINNET_DEPLOYMENT_CONFIRMED=YES_DEPLOY_ROBINHOOD_MAINNET` is explicitly set.

Run `scripts/deploy-mainnet.sh`, record its outputs, and then run `scripts/smoke-test-mainnet.sh`.

## Go-live gate

Do not point the public launcher at the mainnet factory until the smoke test verifies:

- canonical PoolManager;
- permanent hook/adapter/factory bindings;
- treasury and rewards controller;
- immutable fee and curve values;
- deployed bytecode at every protocol address.

After verification, perform one low-value disposable mainnet launch and a low-value buy/sell/claim cycle before launching the project token.
