# Robinhood Chain mainnet deployment record

Status: **deployed and application-verified; not yet public**

This record captures the reviewed RMT V4 infrastructure deployed through the wallet-signed mainnet console. It does not declare the contracts audited and it does not authorize unrestricted public trading.

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

## Remaining go-live gates

- [ ] Publish matching source and compiler settings on Blockscout.
- [ ] Record every governance, vault, hook, adapter, router, and controller address and transaction hash.
- [ ] Run a disposable low-value mainnet launch.
- [ ] Run low-value buy, sell, reward accrual, and claim checks.
- [ ] Exercise graduation on a disposable launch or document a bounded staging exception.
- [ ] Point the public frontend at the version registry only after the smoke checks pass.
- [ ] Keep the official RMT project token unlaunched until the disposable smoke launch succeeds.
- [ ] Obtain an independent smart-contract security review before describing the release as audited.

The registry coordinates future factory versions only. It cannot rewrite existing tokens, markets, reward vaults, or liquidity.
