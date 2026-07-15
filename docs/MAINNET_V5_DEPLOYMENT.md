# Robinhood Chain canonical V5 deployment

Status: **deployed and application-verified by the wallet-signed release console; Blockscout source publication is required before V6 governance proposals**

- Chain: Robinhood Chain mainnet
- Chain ID: `4663`
- Version: `RMT_FACTORY_V5`
- Operator/deployer: `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`
- Factory creation block: `9567266`
- Terminal/indexer start block: `9567266`

The public terminal and production indexer intentionally start at the V5 factory creation block and read only the V5 factory. Legacy V4 coins do not appear in the terminal. The V5 factory still consults the legacy V4 factory when reserving identities, so names and tickers already used on RMT cannot be reused.

## Canonical addresses

| Role | Address | Deployment transaction |
| --- | --- | --- |
| Expandable governance | `0x13c0a930516fb6bf0d467b38605d9d2a9c4c6953` | `0x7c443a6295f62d66cfbb3a72562627e6f4c0e29334ffec8ff4160d13a8168d25` |
| Treasury vault | `0xf4d43a778c14babefb3ac2e73e673f410fc33d23` | `0xe9b41130908c6e4b3c8e381ea2769ed0f0d72595afbd2f55ac3d4c15eb4415d7` |
| Buyback vault | `0x9c929181d63f6b54c668e84ac3d941ec9d72655a` | `0x83c7c29d7bc2a29a6564d51b09b8e1270f4b4733468f2fe00db6dac4524e3666` |
| Graduation vault | `0xc9a51b5106a6320ab138f3062d6c2892209287cb` | `0x2abfa1ee14b131ac0669b0f17c27f9d5f5600a2e309fc0d29b7daa5d25892684` |
| Referral vault | `0x44d9adc5043c25b18d0b4bc58d2ec56fb1883b0b` | `0x31360e90551b7b008561ed860e629e954ef7acf25627c416bd158fb7634f9716` |
| Ecosystem vault | `0x8b407c04a031b5206bf233e0cb497fcd55d7ed47` | `0x19ac79035240e4533ccf3a42d75309764fa110b65246752797861b5ef722d255` |
| Graduation hook | `0xfe5ad8AFab28D9358492C3Dc030cA7Aa208d6880` | `0xa5c08d485e584f51f5da3eb206327b0b5a2df8dceaef0c3c2de4e7b334763c7d` |
| Graduation adapter | `0xf25bc82a271648e5aeea0a28523c44ec4515ab78` | `0xd7d206f3690e676f32cf3d5d98358b0b4c61db59503f394a641f3c691a12da82` |
| Revenue router | `0x066fd10caf090f274d1861e4f838558f98ce1ee9` | `0x0f0309e6a9751036314d73f7606a9d20de818bd08ea136c83bd694b97a2c5735` |
| Rewards controller | `0xed282288e583605850ec7e0e430b7bf9f9fd7d45` | `0x921825e962cd241b297d69aaab21bbb6541c2653d5bdc2ad8e8560379b6aa9d0` |
| V5 launch factory | `0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd` | `0x15130a81cb3500ab3f6f5bd1c982a1def8f60fb5efcccabeb09f65222639302b` |
| V5 version registry | `0x4b8b222b5caa7066c02a54e51ec1a674adf5b3a1` | `0xe388530d506103906332daec3d456272b5c8f202a590b1fb16f0591c3c9332f9` |

## Permanent binding transactions

- Hook → adapter: `0x687a8a2ef4d50139fd82ab529975ff7d92f813a58cf3678cebf4210fd707b0c6`
- Adapter → factory: `0xc23a14d59849b44b7872aa7669f7aefc5a4a508b440b267da1db87bd34839766`
- Rewards controller → factory: `0x390cb9b0e1371b1f6763cdded0335d0007d1575fce0d78bd0a969b79a335fb10`
- CREATE2 hook salt: `0x00000000000000000000000000000000000000000000000000000000000028a2`

## Verified release configuration

- Governance begins with the operator as the only signer, threshold `1`, and a 24-hour execution delay. Additional signers can be added later through governance.
- Trading fee: `1%`.
- Graduation target: `2 ETH` net real reserve.
- Fair Start: 1-block opening delay, 10 protected blocks, 1% maximum per buy, 3% cumulative maximum per wallet, one buy per wallet per block, and recipient-equals-buyer enforcement.
- Community and protocol settlement uses fixed-purpose destinations.
- The V5 factory inherits duplicate-name and duplicate-ticker protection from the legacy V4 factory.

The deployment console verified deployed bytecode, permanent bindings, immutable economics, governance configuration, vault purposes, revenue destinations, Fair Start constants, the active registry factory, and the `RMT_FACTORY_V5` version. This record does not claim an independent audit or live public-token graduation.
