# RMT V6 mainnet release

Status: **draft release candidate — not deployed, active, or open**

This is the operator handoff for the policy-driven V6 release. Completing tests does not authorize a deployment. Deployment does not authorize activation. Activation does not authorize reopening launches.

## Current mainnet dependencies

- [Expandable governance](https://robinhoodchain.blockscout.com/address/0x13c0a930516fb6bf0d467b38605d9d2a9c4c6953) — one operator signer, threshold 1, 24-hour execution delay, delayed ability to add a signer
- [Active V5 factory](https://robinhoodchain.blockscout.com/address/0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd) — remains active until the complete V6 candidate is ready
- [Version registry](https://robinhoodchain.blockscout.com/address/0x4b8b222b5caa7066c02a54e51ec1a674adf5b3a1) — 48-hour factory activation delay
- [Official legacy RMT token](https://robinhoodchain.blockscout.com/token/0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C) — unchanged; used only to document the protected identity being migrated
- [Canonical Uniswap V4 PoolManager](https://robinhoodchain.blockscout.com/address/0x8366a39cc670b4001a1121b8f6a443a643e40951)

The final V6 addresses and transaction hashes must be added here only after receipts and deployed bytecode are independently verified.

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

Both bonding-curve fees and collected V4 position fees use the launch's immutable 70/30 splitter. V4 fees can be collected by anyone, but the caller cannot choose the destination.

The creator controls a two-step payout-wallet change: the current creator nominates a new wallet and the new wallet accepts. Only future creator fees follow the new wallet. Previously deferred ETH or token rewards remain owned by the original recipient. There is no administrator or governance override.

## Fair Start

The website exposes one toggle backed by two immutable policies:

- Fair: one-block opening delay, ten protected blocks, maximum 1% of supply per buy, maximum 3% per wallet, one buy per wallet per block, recipient must equal buyer
- Open: the same economics without the opening restrictions

Fair is the default. These limits end automatically after the protected window. They do not impose a permanent wallet cap.

## Release sequence

1. Freeze the reviewed commit and generated wallet artifact.
2. Complete independent contract and deployment review.
3. Use the operator console to deploy the hook, 0.5% adapter, paused launch gate, policy registry, market implementation, and V6 factory.
4. Verify bytecode, hook flags, adapter/factory bindings, governance, guardian, legacy identity factory, fee tier, and paused state.
5. Submit delayed governance proposals for Fair policy registration, Open policy registration, and V6 registry activation.
6. After the governance delay, execute those proposals. This starts the policy-registry and factory-registry delays.
7. After the policy delay, register both immutable policies and submit the delayed default-policy proposal.
8. After governance and policy delays, set Fair as default.
9. After the registry delay, activate V6. Confirm the V6 launch gate is still paused.
10. Submit and execute the delayed reopening proposal, then wait the launch-gate delay.
11. Re-run production health, wallet, RPC, indexer, mobile, buy/sell, and monitoring checks.
12. Reopen V6 launches only after explicit approval. Launch the official RMT V6 identity from the operator wallet and complete a bounded smoke trade.

Every phase is resumable. A rejected wallet request leaves completed steps recorded. No phase requests a private key or recovery phrase.

## Required evidence before reopening

- Final CI, Slither, web, indexer, and V6 mainnet-fork runs are green
- Independent review references the exact commit and compiled bytecode
- V6 source verification is complete for every deployed component
- Deployed addresses and transaction hashes are published
- Active registry version is `RMT_FACTORY_V6`
- Default Fair and optional Open policies match the published economics hashes
- Launch gate is paused until the last approved step
- Production terminal reads only V6 launch events for the new feed
- Mobile Safari, injected wallets, WalletConnect, and mobile deep links pass
- Monitoring and incident-response contacts are active

## Explicitly not included in V6

Wallet-based Firebase accounts, external launchpad aggregation, recovery/CTO rules, creator reputation, and V7+ features remain frozen until V6 is deployed, public launches are reopened, the official RMT V6 token launches successfully, and production is stable.
