# Existing RMT token and curve

At Robinhood Chain 4663 block **115507511** (2026-11-16 04:58:19 UTC), Robinhood's public RPC and Pocket agreed on block hash `0xddf2900bd08a11e90bd8b5e996727df122a973bd7f745a6c7489d6b24e065110` and every reported receipt, runtime and state read. State requests used the block hash and required canonically served state. Independent Ethereum L1 finality was unverified. [Observation and hashes](rmt-token-identity.json) · [Robinhood Chain connection documentation](https://docs.robinhood.com/chain/connecting/)

| Binding | Official historical V6 issuance | Original V4 issuance |
| --- | --- | --- |
| Token | `0xdBa33be56C89CC9fc014c4459028d7e5c7878671` | `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C` |
| Curve | `0xb26Fb775c0ac365d369BEe9ac2E044C5D90FfBee` | `0xFEee90288a7037fBDb4ec5B05dC7cc5E762D5Fb7` |
| Factory, launch ID | `0x8E75C57079a01ce2094bc4187B78710887547651`, 0 | `0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4`, 1 |
| Supply and decimals | 1 billion, 18 decimals | 1 billion, 18 decimals |
| Recorded creator | `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA` | Same public creator address |
| Recorded reserve, matching actual ETH | 0.056811053479943975 ETH | 0.002822201317027282 ETH |
| Actual curve token balance in base units | `837994797660907738169516833`, matches recorded inventory | `990000000000000000000000000` |
| Curve fee and graduation target | 1%, 2 ETH | 1%, 1 ETH |
| Graduation and liquidity migration | Both false | Both false |
| Canonical receipt | [Block 10387857](https://robinhoodchain.blockscout.com/tx/0x4eb7b596ccdf5d0aa5e4c8d0d50311df5108b44f47d9d39d09b1916524d825d5) | [Block 9156510](https://robinhoodchain.blockscout.com/tx/0xe5cd6ed09a3cccae743b7c29c0ee0971f3797986bce171eadc3642de60b3410b) |

The V6 receipt calls `launchOfficialWhilePaused` on the historically pinned V6 factory. Factory log 42 records the token and curve, and log 43 records the official identity authority and exact V4 token. The identity authority `0x287bb5f822AA721181EdB0B6eEBE9B3e201EC4B9` confirms the authorized launcher and factory and is consumed. Each launch receipt records a full mint to its factory and full inventory transfer to its own curve. The V6 receipt contains no legacy-token logs, and the helper's code consumes only the identity authorization. The two supplies and curves are independent. [Official identity helper](../../../packages/contracts/src/OfficialRMTIdentityMigration.sol) · [Earlier evidence from PR #577](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/347ea6c2955b59b7f082a5e43579bd164b9a640c/docs/RMT_LAUNCH_BASELINE_EVIDENCE.md)

The older deployment record labels V6 launch 0 retired and calls it user-created. Preserve the retirement label for product discovery and use the official identity event for issuance provenance. The old transparency repository described the official V6 market when it was current. The website archive classifies it as retired and keeps original V4 launch 1 and V4 launch 0's deployment test separate. Names, tickers and external market listings do not establish identity. [Retirement record](../../RETIRED_LAUNCH_ZERO.md) · [Historical public deployment record](https://github.com/LandoCrissian/rmt-transparency/blob/main/docs/DEPLOYMENTS.md) · [Website discovery methodology](../../RMT_ROBINHOOD_CHAIN_DISCOVERY_REVIEW.md)

## Permissions and curve boundaries

Both token addresses are fixed-target, 45-byte ERC-1167 clones of the historical Solidity implementation. The checksum-pinned Solidity 0.8.26 rebuild with optimizer 200, via-IR and Cancun matched executable code for both targets after removing the Solidity metadata trailer. Full metadata differs. Source and matching executable dispatch show standard ERC-20 allowance and transfer operations, immutable initialized supply, and no owner, mint, burn, pause, tax, blacklist or upgrade method. `owner()` and `mint(address,uint256)` reverted with empty data on both. A read-only initializer replay reverted with `AlreadyInitialized()`. The recorded creator is attribution for the token and is also the initially designated fee beneficiary under the separate V6 splitter. [Token source](../../../packages/contracts/src/clone/CloneFixedSupplyMemeToken.sol) · [Compiler and calldata evidence](rmt-token-identity.json)

The V6 splitter `0x2f31B7f8BeEdBE63BB099701729500EC81389023` remains bound to the same token and market, with 70% creator and 30% historical protocol share. Its creator payout remains the original creator at the checkpoint. Under the historical splitter source, the bound authority `0x52C43239Df8965EB27f26E115cC5EAd11B35d5C3` can select the original creator or protocol treasury for future receipts, subject to its existing evidence and nonce checks. This release does not authorize a redirect. The old V6 factory is paused for creation. [Historical splitter source](../../../packages/contracts/src/DirectLaunchFeeSplitter.sol) · [Historical release record](../../V6_MAINNET_RELEASE.md)

The reserved v4 PoolId `0x752469c7db2ae1dfe84805da2544f49182a4e09bde952acb548a824f8eb8815b` derives from the observed manager `0x8366a39CC670B4001A1121B8F6A443A643e40951`'s PoolKey of native ETH, V6 token, fee 5000, spacing 200 and hook `0x6cf7048C901b513D0E8B1B13C66F3d37705a28a0`. Uniswap's official StateView reported zero sqrt price and active liquidity. The adapter reported zero locked liquidity for this token. This verifies the state of the reserved pool only. External market liquidity, holder distribution and hosted routing were outside this check. [Uniswap v4 Robinhood deployments](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663) · [PoolKey and observed state](rmt-token-identity.json)

## Reuse or replacement

- **Preserve and reference the existing official V6 issuance.** This retains the token address, balances, curves and historical claims. Keep the original V4 issuance separate. The frozen new factory serves a different role and creates a new token for each new launch. Its same-token successor path operates on projects registered through that engine. [Pinned source factory](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/8dca5773cbd4dc98f52a45616f420bce96b000f0/packages/contracts/src/RMTLaunchCurveFactoryV1.sol) · [Frozen compiler profile](../rmt-task043/4663-rotation-profile.json)
- **Replacement requires a separate explicit owner decision.** A replacement begins with a different address and supply. Any holder conversion, liquidity movement, or entitlement mapping would require a separately authorized design, security review and release. The phrase “new RMT token” does not specify any of those terms.

## Replay

From the repository root, set `$PinnedSolc` to the native Windows 0.8.26 binary whose SHA-256 is in the observation. The dependency checkout is the pinned #594 workspace with viem installed. The verifier selects a fresh common block, compares both providers and fails if required evidence disagrees or is unavailable.

~~~powershell
node docs/evidence/rmt-task047/rmt-token-identity.mjs --checkout ../rmt-task026-acceptance --solc $PinnedSolc
~~~
