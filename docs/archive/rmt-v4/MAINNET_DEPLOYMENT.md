# Robinhood Chain legacy V4 deployment record

> Archived product generation. Superseded for new launches first by the [V5 deployment](../../MAINNET_V5_DEPLOYMENT.md) and now by the [current V6 deployment](../../MAINNET_V6_DEPLOYMENT.md). This record is retained only as historical evidence and as part of the protected identity history for names and tickers used before V5.

Status: **retired; infrastructure deployed and launch-loop smoke-tested with one disposable operator token; no community or public project launched through RMT V4**

Public application: https://www.rmtlaunch.fun

This record captures the reviewed RMT V4 infrastructure deployed through the wallet-signed mainnet console. It does not declare the contracts audited or risk-free.

## Release identity

- Chain: Robinhood Chain mainnet
- Chain ID: `4663`
- Release source: `ce7573b36c924c6933907e7f214d74a215b796f8`
- Operator/deployer: `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`
- Launch factory: `0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4`
- Version registry: `0xfff3f69f473780EA5eA7f5525526986Bb491E00e`

## Explorer evidence

### Launch factory

- Creation block: `8862129`
- Creation transaction: `0xd048492fb969a1215f0d07b7dfd6454e13d629bad8a1a59a0ff6619099ae9177`
- Explorer: https://robinhoodchain.blockscout.com/address/0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4

### Version registry

- Creation block: `8862339`
- Creation transaction: `0xc696f2f0fb70592e8969127fd0bfb76c972f7dd5fbc2c54ef6f8a9e4b74cebf8`
- Explorer: https://robinhoodchain.blockscout.com/address/0xfff3f69f473780EA5eA7f5525526986Bb491E00e
- Initial registry event records active factory `0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4`.
- Initial version: `0xdef50385924e38ff5aec5dc38e5e0215be1b43ba2d4d1d0bfbf6f3141e1b3426`
- Activation delay encoded at deployment: `172800` seconds (48 hours)

## Verification completed by the deployment console

Before showing “Mainnet stack verified — not yet published,” the console checked:

- bytecode at all 14 deployed protocol addresses;
- canonical Robinhood Chain PoolManager and CREATE2 deployer;
- permanent hook, adapter, factory, rewards-controller, router, and registry bindings;
- immutable curve fee, virtual reserves, supply, and graduation target;
- three 2-of-3 governance contracts and their distinct signer set;
- five distinct protocol-purpose vaults and immutable revenue distribution;
- 24-hour controlled-release delays and 48-hour factory-version activation delay;
- Fair Start delay, duration, per-buy limit, cumulative wallet limit, and one-buy-per-block enforcement.

## Disposable mainnet smoke evidence

The operator completed the bounded V4 launch loop with a clearly labeled disposable token:

- Token: `0xbDE596366551AaCae3E7C397b72F53f2A524582A`
- Market: `0xe0dED88c6D2aB5831C64d57F4d4ed21c3512f6c4`
- Reward vault: `0x8C91Ac046A6b20f33E43FC4eEc4f765B69c5c83e`
- Buy transaction: `0x6e15532a730c9721b8cd4ecb457282e0b1e911d814bdcb6ef41f5f1c2091175b`
- Sell transaction: `0x0a99eb8e438990281d636c505935ece6afa78f573c93b4144c00fd4fb5bb9a15`
- Creator-reward claim: `0x97248fa1d98f4363d846dd4f95d4d42d6ca70c3c2150c0acc5e61f8d1983eb8c`

This proves factory launch, market custody, curve buy and sell accounting, fee accrual, and pull-based creator claims on Robinhood Chain mainnet. It does not by itself prove DEX graduation or constitute an independent security audit.

## Bounded graduation validation

A live disposable graduation was intentionally not purchased because the immutable reserve target is `1 ETH`. Instead, the release gate forks the deployed Robinhood Chain mainnet state and exercises the exact deployed factory at `0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4`.

The fork proof:

- launches a disposable token through the deployed V4 factory;
- advances beyond the immutable Fair Start window;
- buys through the curve until the real reserve exceeds the exact `1 ETH` target;
- verifies the market becomes graduated and curve trading is closed;
- calls the permissionless liquidity migration;
- verifies the reserved pool opens through the permanently bound adapter and hook;
- verifies the returned venue is canonical Uniswap V4 PoolManager `0x8366a39CC670B4001A1121B8F6A443A643E40951`;
- verifies neither the market nor adapter retains ETH or token inventory after settlement.

This is a bounded staging exception, not a claim that a live token has already graduated. The permanent test is part of the Robinhood mainnet-fork workflow and must remain green for future release changes.

## Remaining broad-launch gates

- [x] Publish matching factory and version-registry source and compiler settings on Blockscout.
- [x] Publish and exact-match verify all 14 RMT-owned production contract sources on Blockscout.
- [x] Record every governance, vault, hook, adapter, router, and controller address and transaction hash in `MAINNET_CONTRACTS.md`.
- [x] Run a disposable low-value mainnet launch.
- [x] Run low-value buy, sell, reward accrual, and claim checks.
- [x] Exercise full graduation against deployed mainnet state on a fork and document the bounded live-cost exception.
- [x] Point the public mainnet-beta frontend at the version registry after smoke checks passed.
- [x] Publish the canonical application domain.
- [x] Keep the official RMT project token unlaunched until the disposable smoke launch succeeds.
- [ ] Obtain an independent smart-contract security review before describing the release as audited.
- [ ] Complete one live public-token graduation and DEX migration before a broad unrestricted launch.
- [ ] Deploy the persistent indexer, primary production RPC, and independent backup RPC.
- [ ] Complete attorney review of the public disclosures.

The registry coordinates future factory versions only. It cannot rewrite existing tokens, markets, reward vaults, or liquidity.
