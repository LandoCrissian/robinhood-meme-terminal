# Robinhood Chain canonical V6 deployment

Status: **live mainnet beta, active factory, new launches paused for V7 preparation**

- Public application: https://www.rmtlaunch.fun
- Live status: https://www.rmtlaunch.fun/status
- Chain ID: `4663`
- Protocol version: `RMT_FACTORY_V6`
- Version hash: `0xed6920a17ef2329c2af2fdcc7e5161caa6adc888a820cc1f04b540aab70a5c7f`
- Factory creation block: `10248855`
- Operator/deployer: `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`

## Canonical contracts

| Component | Address | Creation transaction |
| --- | --- | --- |
| Governance and protocol treasury | [`0x52c43239df8965eb27f26e115cc5ead11b35d5c3`](https://robinhoodchain.blockscout.com/address/0x52c43239df8965eb27f26e115cc5ead11b35d5c3) | [`0xe881a468f0776f0488687ccf07a4247e6a9fe5020f53fb57e99794934546529f`](https://robinhoodchain.blockscout.com/tx/0xe881a468f0776f0488687ccf07a4247e6a9fe5020f53fb57e99794934546529f) |
| One-use bootstrap controller | [`0x0463903bff210bf07d65bcf83ddbfc25cb480068`](https://robinhoodchain.blockscout.com/address/0x0463903bff210bf07d65bcf83ddbfc25cb480068) | [`0xabec72d76da2674c3b6b5f187481842ed2dddaf29c54059b922486ac14efcdfd`](https://robinhoodchain.blockscout.com/tx/0xabec72d76da2674c3b6b5f187481842ed2dddaf29c54059b922486ac14efcdfd) |
| Version registry | [`0x27c0269e16209eee149e2738d0819a2633f44246`](https://robinhoodchain.blockscout.com/address/0x27c0269e16209eee149e2738d0819a2633f44246) | [`0xc786eb1768a579e263901c2bc48b55666f1f1aec407f799dff9d5c36393a0556`](https://robinhoodchain.blockscout.com/tx/0xc786eb1768a579e263901c2bc48b55666f1f1aec407f799dff9d5c36393a0556) |
| V4 graduation hook | [`0x6cf7048C901b513D0E8B1B13C66F3d37705a28a0`](https://robinhoodchain.blockscout.com/address/0x6cf7048C901b513D0E8B1B13C66F3d37705a28a0) | [`0x28f2e1b02dbb2cbb52e01b72990f75fa178d5b1271c98653a3cac636718e5ff8`](https://robinhoodchain.blockscout.com/tx/0x28f2e1b02dbb2cbb52e01b72990f75fa178d5b1271c98653a3cac636718e5ff8) |
| V4 graduation adapter | [`0x680a227794b1204a57aab6bac56a84d3280e40a6`](https://robinhoodchain.blockscout.com/address/0x680a227794b1204a57aab6bac56a84d3280e40a6) | [`0x24ec0cc45d31b0017a6e9c4cd007aea3b6f8ad87230b455cb86105ed289f27de`](https://robinhoodchain.blockscout.com/tx/0x24ec0cc45d31b0017a6e9c4cd007aea3b6f8ad87230b455cb86105ed289f27de) |
| Public launch gate | [`0x64b33adb0449ffb946f86a3b0b79a357644bf924`](https://robinhoodchain.blockscout.com/address/0x64b33adb0449ffb946f86a3b0b79a357644bf924) | [`0x2bf287c31e1be1f93a89b7f81a23ee03c5135487a8b2d72b6c36812edc7e6657`](https://robinhoodchain.blockscout.com/tx/0x2bf287c31e1be1f93a89b7f81a23ee03c5135487a8b2d72b6c36812edc7e6657) |
| V6 market implementation | [`0x7cfa54A82BAEE5Bc3CF6177F76C20eAb9AfedF41`](https://robinhoodchain.blockscout.com/address/0x7cfa54A82BAEE5Bc3CF6177F76C20eAb9AfedF41) | [`0x53feb7cad914381b3018c6722d7a48971393bc1cf800c22a5009b0d71ddb49df`](https://robinhoodchain.blockscout.com/tx/0x53feb7cad914381b3018c6722d7a48971393bc1cf800c22a5009b0d71ddb49df) |
| V6 policy registry | [`0x70177a46a38c981480fee9586ccbe281ee70dfcf`](https://robinhoodchain.blockscout.com/address/0x70177a46a38c981480fee9586ccbe281ee70dfcf) | [`0xc467de8cb08edb18e20d7e003cc5b24a3aca615f3b2baeb3ba676ba2a763148c`](https://robinhoodchain.blockscout.com/tx/0xc467de8cb08edb18e20d7e003cc5b24a3aca615f3b2baeb3ba676ba2a763148c) |
| V6 launch factory | [`0x8e75c57079a01ce2094bc4187b78710887547651`](https://robinhoodchain.blockscout.com/address/0x8e75c57079a01ce2094bc4187b78710887547651) | [`0xc22f97fa8d9deb9b7b45add0f4b93bff43dab3962dcffc8d8817dc4d8e9b05ff`](https://robinhoodchain.blockscout.com/tx/0xc22f97fa8d9deb9b7b45add0f4b93bff43dab3962dcffc8d8817dc4d8e9b05ff) |

The adapter was bound to the hook in transaction [`0x9aaa9a745dd0e1ef60bc3b2a782d773c543cf6397d609ade7522facd1279fb1a`](https://robinhoodchain.blockscout.com/tx/0x9aaa9a745dd0e1ef60bc3b2a782d773c543cf6397d609ade7522facd1279fb1a). The adapter was bound to the V6 factory in transaction [`0xe36e8f6a6b89e64bf2aec742df8c702acebc3cfc2633871468c00e1126985578`](https://robinhoodchain.blockscout.com/tx/0xe36e8f6a6b89e64bf2aec742df8c702acebc3cfc2633871468c00e1126985578).

This is the reconstructed top-level foundation record, not yet a complete fifteen-contract release archive. The exact addresses or receipts for the two bootstrap verifier children, factory-created token implementation, fee-splitter implementation, official identity migration helper, V6 activation/opening, and the official RMT launch and splitter still need to be recovered from confirmed onchain state/events and added here. Their absence from this document is not evidence that those steps did not occur; it means the repository record is incomplete and must not be described as a complete audit trail.

## Official V6 RMT launch

| Component | Address |
| --- | --- |
| Official RMT V6 token | [`0xdBa33be56C89CC9fc014c4459028d7e5c7878671`](https://robinhoodchain.blockscout.com/address/0xdBa33be56C89CC9fc014c4459028d7e5c7878671) |
| Official RMT V6 market | [`0xb26Fb775c0ac365d369BEe9ac2E044C5D90FfBee`](https://robinhoodchain.blockscout.com/address/0xb26Fb775c0ac365d369BEe9ac2E044C5D90FfBee) |
| Legacy provenance anchor | [`0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C`](https://robinhoodchain.blockscout.com/address/0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C) |

The official token is V6 launch `0`. It has a new fixed one-billion-token supply. The legacy address is a provenance anchor only; legacy balances were not copied, swapped, or migrated.

## Immutable launch economics

- fixed supply: `1,000,000,000`
- virtual native reserve: `0.3 ETH`
- virtual token reserve: `1,017,500,000`
- graduation target: `2 ETH` net real reserve
- curve fee: `1%`
- creator share of genuine trading fees: `70%`
- protocol share of genuine trading fees: `30%`
- post-graduation V4 pool fee: `0.5%`
- graduation liquidity: full range, permanently locked, no removal function

The same 70/30 splitter receives curve fees and collected fees from the canonical V4 position. Creators receive fees only; they receive no initial token allocation, liquidity ownership, or claim on locked principal.

## Production boundary

The public V6 terminal starts at factory block `10248855` and indexes `TokenLaunchedV6` events from the active V6 factory. V4 and V5 launches remain historical and do not appear as V6 launches. The V6 factory still consults the legacy identity source so protected RMT names and tickers cannot be reused through the current RMT launch flow. New launches are intentionally paused while V7 is designed; existing deployed markets remain available for trading.

The live `/status` page verifies the chain connection, active registry/factory/version, public launch gate, immutable economics, latest V6 market, and graduation adapter. The persistent production indexer derives its factory, policy-registry, governance, creator-payout-authority, and treasury bindings from live contracts and refuses to start when they do not match V6.

## Verification and audit status

This deployment is live and application-verified, but it is not independently audited.

Exact Blockscout source publication remains incomplete. As of July 16, 2026, key V6 explorer records display a generic `contracts/StubContract.sol` compiled with Solidity `0.8.7` instead of the canonical Solidity `0.8.26`, optimizer `200`, via-IR build. Those explorer records must not be treated as exact source equivalence. The canonical repository source, deployment receipts, live bytecode/state checks, and automated test evidence remain available for an independent reviewer, but RMT must not claim that the contracts are source-verified or audited until the exact publication and review are complete.

## Historical records

- [V5 deployment](MAINNET_V5_DEPLOYMENT.md) — legacy identity source and historical launch stack
- [V4 deployment](MAINNET_DEPLOYMENT.md) — superseded historical deployment
- [V6 release runbook](V6_MAINNET_RELEASE.md) — deployment and opening procedure retained as release evidence
