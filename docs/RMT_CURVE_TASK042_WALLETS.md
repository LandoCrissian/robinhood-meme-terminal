# Project treasury wallet and marketplace compatibility

[Task 042](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/612) establishes the beneficiary boundary for the [Task 041 deployment manifest](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/611). These are read-only chain and marketplace observations. The candidate's claim and transfer results come from the separate local rehearsal.

## Wallets and control

| Role | Compatible path | Evidence and limits |
| --- | --- | --- |
| Creator EOA | Create as the project identity. With zero treasury allocation, the creator's EOA claims remaining project credit from the curve or LP ledger. | Use the same chain-qualified EOA throughout a direct claim. Test-ready browser paths are gated to 31337. Robinhood documents MetaMask and its native wallet on 4663. Physical device and checkout approval remain separate. [Robinhood wallet setup](https://docs.robinhood.com/chain/add-network-to-wallet/) |
| Independent treasury EOA | Commit a distinct EOA and a positive percentage of the project's 90% at creation. The treasury EOA claims its own ETH or LP asset credits and can transfer them under its own key. | The 100% project setting encodes 9,000 bps of total fees. It leaves project credits entirely with the treasury and keeps both RMT five-percent entitlements and creator identity. An EOA has single-account spending authority. |
| Existing SafeL2 1.4.1 treasury | The project chooses an already deployed Safe with compatible native receive and owner-authorized contract calls. The Safe itself calls the correct ledger and receives its own assets. Existing signers can approve later ETH and ERC-20 transfers. | Official 4663 artifacts and an existing 2-of-3 deployment were independently corroborated below. Route the Safe's claims through its own project-approved Safe tooling or local test harness. The RMT browser's direct-transaction recovery proof applies to EOAs. An external Safe execution needs its own outer receipt and inner call attribution. [Safe contract interaction](https://help.safe.global/articles/4180673514-transaction-builder) · [Safe execution ABI](https://docs.safe.global/reference-smart-account/transactions/execTransaction) |
| Safe 1.5.0 and other smart accounts | Each actual wallet needs exact runtime, implementation and authority evidence, plus a claim and outgoing transfer rehearsal for its supported policy. | The official hosted Safe network metadata recommends 1.5.0. Its published components are deployed. This identifies a wallet-runtime option. It does not establish all 1.5.0, guarded, modular, passkey, account-abstraction or undeployed wallet configurations for this release. |

The immutable beneficiary address belongs to the project. It cannot be corrected in the factory or ledger after creation. Verify the full address on the right chain with its actual controller before confirmation. For a contract recipient, support requires both accepting each eligible asset and initiating ordinary calls to the ledgers. Empty code alone cannot prove control of a counterfactual address. Require a verified existing treasury and explicit beneficiary review. An inaccessible immutable payee can strand its credit. Threshold, ownership and eligible spending policy may change inside the project's external account under its own rules. RMT has no embedded treasury wallet, signing key, clawback or beneficiary redirect.

### Verified Safe deployments

The official [Safe registry release v1.37.58](https://github.com/safe-global/safe-deployments/releases/tag/v1.37.58), commit `c25243b456237ee5af122c4fe444866315afab53`, includes Robinhood 4663. Official Robinhood, Pinax and Pocket all matched the six observed registry components for **each** of 1.4.1 and 1.5.0 at block **114556006**, `0x4d4136b255e131260c3d65163f9074764407c3bff4a13e51a82ce6b38ed67446`. Pinax and Pocket also matched the 1.4.1 singleton, factory and fallback at the older 4663 RMT fork anchor **113412054**. The official RPC returned `-32000` for historical bytecode. [Three-provider runtime and storage evidence](evidence/rmt-task042/wallets/safe-and-seaport-4663.json)

| 1.4.1 component | Canonical address | Runtime Keccak-256 |
| --- | --- | --- |
| SafeL2 singleton | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` | `0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff` |
| SafeProxyFactory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317` |
| CompatibilityFallbackHandler | `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` | `0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9` |
| Created SafeProxy sample | `0xffe8dd7bd7c52d211879104aef901ccea5727b67` | `0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c` |

All three RPCs verified the sample's 171-byte proxy, singleton through `masterCopy()` and storage slot zero, `VERSION() = 1.4.1`, threshold two and three owners. The sample had no modules or guard and used the canonical fallback handler at the observation. Its historical successful creation receipt and exact factory `ProxyCreation` event identify the proxy and singleton at block **114339644**, log index **13**. The sample is unrelated to RMT and demonstrates a deployed compatible configuration shape. For an actual beneficiary, repeat the proxy, singleton, initialized ownership, threshold, modules, guards and fallback checks. Runtime alone does not establish the instance's policy. [Historical factory receipt](https://robinhoodchain.blockscout.com/tx/0xe957e0e296eebc5c0d8153fd43097c55cd672c19817ff21312e0f94248c00dac) · [Official proxy source](https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/proxies/SafeProxy.sol)

Safe's [hosted chain configuration](https://safe-client.safe.global/v1/chains/4663) returned HTTP 200 for `robinhood`, chain 4663, alongside an HTTP 200 status response from the [Robinhood transaction service](https://api.safe.global/tx-service/robinhood/api/v1/about/) at version 6.14.0. This confirms present hosted network metadata and service reachability. It does not verify a hosted signing session or grant access to any service.

The official Base Sepolia RPC also matched those three 1.4.1 runtime identities at the existing browser-fork anchor **57648300**, hash `0x5bb29976ce80ddede79f192c61eba8fe9d96f499f8bfa11e0820d11820e91d20`. This supplies the exact Safe code for the isolated 31337 browser fixture without introducing a new deployment dependency. [Base Sepolia anchor read](evidence/rmt-task042/wallets/safe-base-sepolia-anchor.json)

### Claim and transfer checklist

1. For either beneficiary, independently confirm the exact 4663 asset, curve or LP ledger and the balance for the beneficiary. Display uncollected position fees, earned credits and actual withdrawals separately. Creator/treasury credits from the LP are limited to realized fees from the original locked position.
2. In an approved wallet use the curve ledger's zero-value `claim()` or the LP ledger's zero-value `claim()` / `claimAsset(true)` for ETH / `claimAsset(false)` for launch tokens. The selectors are `0x4e71d92d` and `0xd51867eb`. These calls pay the ledger caller. A wallet that rejects native ETH cannot use the combined claim when ETH is owed, and can still claim its token credit through the token-only method if it can execute the call. A native-only curve credit requires a compatible receiver at the already committed address.
3. For a Safe, review the full project-approved account, chain, target, value, calldata, nonce and quorum before using its ordinary CALL path. Its owners validate the transaction and an authorized submitter supplies gas. Separate the Safe's signed intent/hash from the mined transaction hash. For confirmation, bind the canonical receipt to the Safe execution and the ledger's claimant and asset evidence. If the required trace or exact native asset movement is unavailable, keep settlement unverified. [Safe's own transaction review procedure](https://help.safe.global/articles/2485383995-how-to-perform-basic-transactions-checks-on-safewallet)
4. For project-approved spending, move only the reviewed amount and asset to the designated EOA on the same chain, or execute a supported external protocol call directly from the treasury. An Ethereum L1 or other chain destination needs its own approved transfer/bridge details. A transfer to the EOA changes custody to the EOA controller. Retain the treasury approval and outgoing receipt, the EOA purchase receipt and the final NFT or token owner separately. A later move of an NFT back to the treasury is a separate transfer with its own receiver check. Safe 1.4.1's canonical compatibility fallback includes ERC-721 and ERC-1155 receiver interfaces. [Verified handler source](https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/handler/TokenCallbackHandler.sol)

## Marketplace evidence

| Capability | Finding |
| --- | --- |
| Browse Robinhood NFTs | OpenSea's actual Robinhood Discover route returned HTTP 200 with the Robinhood collections content. OpenSea documents this network and ETH support. [Live Robinhood Discover](https://opensea.io/discover/chain/robinhood) · [Supported chains](https://support.opensea.io/en/articles/8867082-which-blockchains-are-compatible-with-opensea) |
| Standard EOA checkout | OpenSea lists EIP-6963 wallets including MetaMask, Coinbase Wallet and Robinhood Wallet. An authorized project spending EOA can use supported wallet tooling, subject to the live listing, supported payment, account and network. The current review verified an already completed Seaport order and receiving EOA shape from public receipts. A current end-user checkout session on a physical device remains untested. [Supported wallet interfaces](https://support.opensea.io/en/articles/8867089-what-crypto-wallets-can-i-use-with-opensea) |
| Direct Safe checkout in OpenSea | OpenSea's current help explicitly says it does not support multisignature wallets in its normal interface. Direct, off-interface Safe execution of a particular valid Seaport order requires separate exact-call and order validation. This review does not qualify it. [OpenSea's multisig restriction](https://support.opensea.io/en/articles/8867089-what-crypto-wallets-can-i-use-with-opensea) |
| On-chain Seaport 1.6 | All three RPCs matched the canonical 23,981-byte runtime at `0x0000000000000068F116a894984e2DB1123eB395`, Keccak `0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00`. The contract returned version 1.6 and the published conduit controller. The OpenSea SDK describes native ETH listings and WETH offers on 4663. Do not assume any arbitrary launch token is accepted at checkout. [Official contract deployment](https://github.com/ProjectOpenSea/seaport#canonical-cross-chain-deployment-addresses) · [OpenSea SDK chain support](https://github.com/ProjectOpenSea/opensea-sdk/blob/main/CHANGELOG.md) |

For the unrelated historical Seaport order at **114556326**, Robinhood's official RPC and Pinax agreed on the successful receipt and exact `OrderFulfilled` log. The zone equals OpenSea's published 1.6 Signed Zone. The order moved one ERC-721 for **0.0022 ETH** paid across its native considerations. The transfer receipt and Pinax's historical `ownerOf(17)` both bind the NFT to the order's receiving address, which had empty code at that block. This verifies the protocol settlement and the recipient's on-chain title at that point. It does not identify the client that submitted the transaction or link it to a project treasury. [Sale receipt](https://robinhoodchain.blockscout.com/tx/0x3b94bb8b8b8ab9070b6e1a3aab2ecfd37407ac4549d60c382a9068eb538d6fd7) · [Order and ownership evidence](evidence/rmt-task042/wallets/historical-seaport-sale.json) · [Signed Zone](https://docs.opensea.io/changelog/seaport-v1-6)

Protocol fee rewards, later project-gated purchases, and any NFT royalty streams are separate events and wallets. This architecture creates no marketplace, automatic token purchase or cross-project routing. Existing RMT and LAMMB terms require their own authorization. Record the exact economics and owner-approved RMT beneficiary addresses separately in #611.

## Read-only reproduction

Use `cast` 1.7.1, an HTTPS public endpoint and the recorded block. Use the official public RPC to corroborate the block and receipt. Use an allowed historical provider such as Pinax or Pocket if state at that block is pruned. Verify the block hash before comparing results. Read failures are unavailable evidence.

```sh
RPC=https://robinhood.rpc.pinax.network
BLOCK=114556006
SAFE=0xffe8dd7bd7c52d211879104aef901ccea5727b67
SINGLETON=0x29fcB43b46531BcA003ddC8FCB67FFE91900C762
cast chain-id --rpc-url "$RPC"
cast block "$BLOCK" --rpc-url "$RPC" --json
cast keccak "$(cast code "$SINGLETON" --block "$BLOCK" --rpc-url "$RPC")"
cast keccak "$(cast code "$SAFE" --block "$BLOCK" --rpc-url "$RPC")"
cast call "$SAFE" 'masterCopy()(address)' --block "$BLOCK" --rpc-url "$RPC"
cast call "$SAFE" 'getThreshold()(uint256)' --block "$BLOCK" --rpc-url "$RPC"
cast call "$SAFE" 'getModulesPaginated(address,uint256)(address[],address)' \
  0x0000000000000000000000000000000000000001 8 --block "$BLOCK" --rpc-url "$RPC"
cast receipt 0xe957e0e296eebc5c0d8153fd43097c55cd672c19817ff21312e0f94248c00dac --rpc-url "$RPC"
cast call 0x0000000000000068F116a894984e2DB1123eB395 'information()(string,bytes32,address)' \
  --block "$BLOCK" --rpc-url "$RPC"
cast receipt 0x3b94bb8b8b8ab9070b6e1a3aab2ecfd37407ac4549d60c382a9068eb538d6fd7 --rpc-url "$RPC"
cast call 0xcbe2aba66c1ae5E2b3b280D25ce32Fd1917Cc3f0 'ownerOf(uint256)(address)' 17 \
  --block 114556326 --rpc-url "$RPC"
```
