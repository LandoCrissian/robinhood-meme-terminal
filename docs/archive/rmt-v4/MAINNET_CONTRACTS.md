# Robinhood Chain legacy V4 contract manifest

> Archived product generation. Superseded for new launches by the [canonical V6 deployment](../../MAINNET_V6_DEPLOYMENT.md); V5 is the intermediate legacy identity layer. These addresses remain documented only for historical verification and legacy identity protection.

Historical V4 status: **retired; infrastructure deployed and recorded; no community or public project launched through RMT V4**

- Chain: Robinhood Chain mainnet
- Chain ID: `4663`
- Operator: `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`
- Reviewed release source: `ce7573b36c924c6933907e7f214d74a215b796f8`
- Canonical PoolManager: `0x8366a39CC670B4001A1121B8F6A443A643E40951`
- Canonical CREATE2 deployer: `0x4e59b44847b379578588920cA78FbF26c0B4956C`

The RMT deployment consists of 14 protocol-owned contracts. The two canonical external infrastructure contracts above are not owned or deployed by RMT.

## Governance

| Role | Address | Creation transaction | Source |
|---|---|---|---|
| Factory governance (2-of-3, no delay) | [`0xA50A6B977Bea3Fed6C56A33EdadE2A4B93F41B99`](https://robinhoodchain.blockscout.com/address/0xA50A6B977Bea3Fed6C56A33EdadE2A4B93F41B99) | [`0x9754…c8de`](https://robinhoodchain.blockscout.com/tx/0x9754d890cb293cc1cc521194480f788c8fa9bf6ec47f0a4333a6d59c7a61c8de) | `TwoOfThreeTimelock.sol` |
| Rewards governance (2-of-3, no delay) | [`0xE39CE3259d8E79628aFA537e83631b51F74f7416`](https://robinhoodchain.blockscout.com/address/0xE39CE3259d8E79628aFA537e83631b51F74f7416) | [`0x7977…328b`](https://robinhoodchain.blockscout.com/tx/0x7977b6f08a0c14f0aa93b98253f1bf0b22fec849f7ff39159588dc45ee3f328b) | `TwoOfThreeTimelock.sol` |
| Protocol governance (2-of-3, 24-hour delay) | [`0xd3aAD8D7CF148f0134f2cb986E0bBa08647678af`](https://robinhoodchain.blockscout.com/address/0xd3aAD8D7CF148f0134f2cb986E0bBa08647678af) | [`0x1ac3…c821`](https://robinhoodchain.blockscout.com/tx/0x1ac3bf5ba3d89169e70672390ac6140abf2e93a9513bab4a752539b6a4b4c821) | `TwoOfThreeTimelock.sol` |

The fixed signer set at deployment comprised three historical wallet addresses. Two distinct signers are required. Signer replacement is possible only through an ordinary 2-of-3 self-call. This legacy manifest does not describe current wallet compatibility or V6 governance.

## Purpose vaults

| Purpose | Address | Creation transaction | Immutable controller |
|---|---|---|---|
| Protocol treasury | [`0x66f589E759b088A070a557e6c4487D18993E923E`](https://robinhoodchain.blockscout.com/address/0x66f589E759b088A070a557e6c4487D18993E923E) | [`0x1f7e…67b8`](https://robinhoodchain.blockscout.com/tx/0x1f7eca57a422d98cb80f7bd3dced5b3e328786d07d439196b91eae12407d67b8) | Protocol governance |
| Buyback reserve | [`0x36D17cD171D54ff4e916aF1aCaFF8A4D54b0b390`](https://robinhoodchain.blockscout.com/address/0x36D17cD171D54ff4e916aF1aCaFF8A4D54b0b390) | [`0x7913…6ffe`](https://robinhoodchain.blockscout.com/tx/0x791386c2f06e35cb8cde1999a95505aac007200f28456c9bcbb0047ff6946ffe) | Protocol governance |
| Graduation assistance | [`0x9407983a579C160C16BE2a338280109cFA833394`](https://robinhoodchain.blockscout.com/address/0x9407983a579C160C16BE2a338280109cFA833394) | [`0x8a4d…4338`](https://robinhoodchain.blockscout.com/tx/0x8a4d32128de7cc3821b4877a4bff73ccb3cbe2272c1732f3d271393366c54338) | Protocol governance |
| Referral reserve | [`0x5cDaaac5880071b84B47a78bfF3dCE97FBA6Ff87`](https://robinhoodchain.blockscout.com/address/0x5cDaaac5880071b84B47a78bfF3dCE97FBA6Ff87) | [`0xd9ff…c6be`](https://robinhoodchain.blockscout.com/tx/0xd9ff6fb52cd4aebcc8fb2bcc91b6661686c8f3e88cb61359237f6d23f7e4c6be) | Protocol governance |
| Ecosystem growth | [`0xd3dadC00884B60bb1Ed945ae5ec5C27e0295B2bE`](https://robinhoodchain.blockscout.com/address/0xd3dadC00884B60bb1Ed945ae5ec5C27e0295B2bE) | [`0xd6ae…d176`](https://robinhoodchain.blockscout.com/tx/0xd6aea4064c65c807914b9da0975570f2b30b349f9bef72ec0f3fb10dbf4cd176) | Protocol governance |

Every vault uses `ProtocolPurposeVault.sol`, has an immutable purpose label, and can release ETH only through protocol governance.

## Launch and graduation infrastructure

| Role | Address | Creation transaction | Source |
|---|---|---|---|
| Uniswap V4 graduation hook | [`0xb0C7fBD1954B1A81832Cd807eb930Cd4aA75a880`](https://robinhoodchain.blockscout.com/address/0xb0C7fBD1954B1A81832Cd807eb930Cd4aA75a880) | [`0xc043…7825`](https://robinhoodchain.blockscout.com/tx/0xc0436784368a3f5c35fd326e0339ab2d2b4870f2407eae8ae2a091eae2f67825) | `V4GraduationHook.sol` |
| Graduation adapter | [`0x183d552B540702FA9BD7fE05F23966E0d449BdeD`](https://robinhoodchain.blockscout.com/address/0x183d552B540702FA9BD7fE05F23966E0d449BdeD) | [`0xae53…1910`](https://robinhoodchain.blockscout.com/tx/0xae5327a7d41a0dfe45f387864de72ef65df940938ea31aeab8dd3494de251910) | `V4GraduationAdapter.sol` |
| Protocol revenue router | [`0xEA3ECFfdbd40C86DF510Ea48b2750bC0652bFbF6`](https://robinhoodchain.blockscout.com/address/0xEA3ECFfdbd40C86DF510Ea48b2750bC0652bFbF6) | [`0xd80d…943c`](https://robinhoodchain.blockscout.com/tx/0xd80d2c0ba34e01f7aaaebc6192ec257c925fef0f9a94302b8db50e65f7bb943c) | `ProtocolRevenueRouter.sol` |
| Purpose rewards controller | [`0x000D53F45106e91733fe74d1DD5D32F15B87644c`](https://robinhoodchain.blockscout.com/address/0x000D53F45106e91733fe74d1DD5D32F15B87644c) | [`0x2d79…9434`](https://robinhoodchain.blockscout.com/tx/0x2d7915c752ddf9014b71fa6466b2b35efca2a44ce42ac12d4b96c8375e379434) | `PurposeRewardsController.sol` |
| V4 launch factory | [`0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4`](https://robinhoodchain.blockscout.com/address/0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4) | [`0xd048…9177`](https://robinhoodchain.blockscout.com/tx/0xd048492fb969a1215f0d07b7dfd6454e13d629bad8a1a59a0ff6619099ae9177) | `LowCostMemeLaunchFactoryV4.sol` |
| Delayed version registry | [`0xfff3f69f473780EA5eA7f5525526986Bb491E00e`](https://robinhoodchain.blockscout.com/address/0xfff3f69f473780EA5eA7f5525526986Bb491E00e) | [`0xc696…ebf8`](https://robinhoodchain.blockscout.com/tx/0xc696f2f0fb70592e8969127fd0bfb76c972f7dd5fbc2c54ef6f8a9e4b74cebf8) | `VersionedFactoryRegistry.sol` |

## Permanent bindings

- Hook → adapter: [`0x4a06…499c`](https://robinhoodchain.blockscout.com/tx/0x4a0654b5d09a3c5a8ac57e78f260b29412604a89579bed8e2eeab63744d3499c)
- Adapter → factory: [`0x3784…0b21`](https://robinhoodchain.blockscout.com/tx/0x37847e0635e9730b9dc632baa98651109f316c09cc02fcf54e7b1cb594430b21)
- Rewards controller → factory: [`0x7260…d18c`](https://robinhoodchain.blockscout.com/tx/0x7260c7eb301b135f5b5efde788d083e339b10e73227eb3724ab779d4f0e3d18c)

These bindings were verified by the release console and are rechecked by the public health endpoint.

## Source verification

The `.github/workflows/verify-mainnet-source.yml` workflow recompiles the exact pinned release sources and verifies all 14 RMT-owned addresses in parallel with their individual constructor arguments. Workflow run 13 passed all 14 exact-address jobs. This proves the published metadata matched the deployed bytecode; it does not replace an independent security audit.

## Disposable launch evidence

See [MAINNET_DEPLOYMENT.md](./MAINNET_DEPLOYMENT.md) for the disposable launch, buy, sell, reward-claim, and deployed-state graduation-fork evidence.
