# RMT Launch Curve V1 review

The initial curve review is [draft #586](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/586) at `453ba728f0620c60adfa2209f62aa03ad4274221`. The [Task 021 handoff](RMT_CURVE_TASK021_AUDIT_HANDOFF.md) covers paid creation and sequential migrations for this undeployed engine. The existing RMT token, curve and previous direct-to-v4 releases retain their original source, runtime, economics and transaction history. All transaction tests use loopback Anvil and synthetic balances.

## Lifecycle and draft economics

| Rule | V1 review value |
| --- | --- |
| Creation | The fixture charges 0.0004 ETH plus network gas. The reference is $2,500 per ETH. The exact amount is immutable for this factory and credits the fixed operating recipient. The full supply starts as curve inventory. No required first purchase, seed liquidity or creator token allocation. |
| Token supply | Draft presets of 1 million, 10 million or 100 million tokens at 18 decimals. All supply is minted once. |
| Curve | Virtual ETH starts at 2 ETH. Virtual token inventory starts at 180% of supply. Actual backing starts at zero and is tracked separately from fee credits, donations and virtual reserves. |
| Progress | Net sold inventory can reach 60% of supply. At that point the curve holds exactly 1 ETH of tracked backing and 40% of supply for graduation. The final buyer can explicitly select atomic buy-and-graduate. Any account can also submit a separate graduation. If funding fails, the transaction rolls back and sellers can still exit. |
| Curve trade fees | Draft 1% of gross ETH traded, rounded up. Review onchain allocation between creator, optional treasury, RMT operating revenue and future RMT token reserve. The draft RMT split is 5% + 5% of the **collected fee**. |
| v4 | Draft standard 0.30% LP fee, spacing 60 and a full-range position with terminal curve price continuity. The initialization-only guard protects the intended key against pre-initialization. |
| LP custody | The original NFT and principal stay in immutable custody. Earned fees from that position can be collected into its separate ledger. Curve fee recipients retain prior credits. Independent LPs retain their own earnings. |

For sold inventory `s`, virtual token reserve `Vt` and starting virtual ETH `Ve`, backing is `ceil(Ve × Vt / (Vt − s)) − Ve`. Buys choose the largest affordable whole-token-base-unit increment, cap it at the graduation threshold and refund unused budget. Sells release the difference between two points on that same integer backing curve. Minimum outputs and deadlines protect both directions. Fee claims use separate accounting. Standalone graduation requires gas from its caller. The atomic path includes the graduation gas in the reviewed buy and rolls back the fill if funding fails.

The ledger applies cumulative nested rounding. It reserves the floored 10% platform allocation, divides it between operating and future reserve buckets and gives a one-wei split remainder to the future reserve. The treasury receives its configured fraction of the nominal 90% project portion, with the creator receiving the project remainder. A recipient that loses access or rejects native ETH keeps its credit. An administrator cannot redirect the payout.

Run `node packages/contracts/scripts/simulate-launch-curve.mjs` for synthetic turnover, reserve, cap-refund and fee cases. Alternatives vary supply, trade fee, fee split and threshold. A 60% sold threshold with the V1 virtual reserves pairs both available assets at the terminal price in the ideal full-range limit. Finite tick bounds and rounding still need onchain deposit checks. At or below 50% sold, that model cannot pair the entire remaining inventory at the terminal price with positive virtual reserves. Zero demand and reversals can keep a launch on its curve indefinitely.

The draft candidate keeps 60% sold, 1 ETH and a 1% fee. In the deterministic four-trade example, about 1.1681 ETH of gross turnover reached 1 ETH of tracked backing and accrued about 0.01168 ETH of fees. Use the [Task 019 economics comparison](RMT_LAUNCH_CURVE_TASK019_REVIEW.md#economics) to review deeper thresholds, adverse order flow and the cost of the threshold transaction before approval.

## Fee scope after graduation

Outside liquidity can dilute the fraction earned by the original position. The same active-liquidity rules apply when an independent router uses the canonical pool. Activity in other pools earns nothing for this position. The historical simulation models #586 without LP distributions. The Task 019 simulation models recipient distributions from the original position.

The collection path encodes a zero-liquidity increase and a fixed payout to the launch's ledger. Before and after collection it verifies the original position's full key, range, custody, liquidity and allowances. It checks exact fee growth and actual native and ERC-20 receipts before crediting the recipients. A universal pool-level swap fee would require a separate v4 hook design and security review. [Uniswap v4 deployment pins](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663)

## Contract and authority manifest

| Component | Authority and dependencies | In-place changes and recovery |
| --- | --- | --- |
| `RMTLaunchCurveFactoryV1` | Immutable graduation and fee recipient bindings. Registers the canonical curve per token. | Immutable. New deployments get a separate reviewed factory version. Continue resolving historical launches against their original factory. |
| `RMTLaunchCurveTokenV1` | Fixed supply set in its constructor. | Immutable. Holders retain transfer rights and balances. No admin migration or replacement mint. |
| `RMTLaunchBondingCurveV1`, V2 and V3 | Fixed curve math, supply, fee ledger and graduation dependencies. Only the bound factory may migrate tracked assets to the reviewed, same-token successor. | Fixed code at each address. Predecessor closure and successor opening are atomic. A failed migration or graduation restores the active curve. |
| `RMTLaunchCurveRevenueLedgerV1` | Immutable project, operating and future reserve entitlements. The active curve can transfer accrual authority to the authenticated successor during migration. | Credits and claims remain at the original address. Recipients claim their own balances. |
| `RMTLaunchCurveDeploymentV1` | Binds the factory, graduation engine and guard with predicted addresses and constructor dependencies. The separately deployed successor template has an explicit runtime pin. | A failed atomic deployment can be retried with reviewed inputs. |
| `RMTV4CurveGraduationV1` and `RMTV4CurveInitializationGuardV1` | Pinned PoolManager, PositionManager and Permit2. Only the bound engine can initialize its guarded key. The engine holds the original LP NFT and can collect position fees to its dedicated ledger. | Retry failed graduation without changing balances or replacing the token. No emergency principal withdrawal. |
| `RMTLaunchCurveLpFeeLedgerV1` | Receives verified native and ERC-20 proceeds from the original position and records fixed recipient shares. | Pull claims. Unsolicited transfers create no fee entitlement. |
| `RMTLaunchCurveDirectoryV1` | A separate 2-of-3 EIP-712 threshold authorizes discovery decisions. Factory version, address and runtime hash bind each publication. | No proxy or asset custody. Replace the directory by explicitly repinning its address and replaying reviewed publications. Existing curves continue through their own addresses. |
| `RMTLaunchProjectRegistryV1` | Permanent token identity, factory, originating curve, current curve and append-only migration history. Accepts new projects only from versioned factory pins. | Records migration after the factory, predecessor and successor agree. Read the original registry if any future directory is replaced. |
| Successor deployers | The factory pins the fixed V2 template. The directory records V3 and later approved adjacent template runtimes after notice. | The helper deploys code and holds no launch assets. Exact candidate approval is separate from template publication. |
| `RMTLaunchHolderMigrationV1` | Separate 31337-only prototype. Creator opt-in and pinned registered original token. Constructor mints a dedicated fixed-supply replacement into escrow. | Irreversible 1:1 redemption by a holder using their own exact allowance. Original tokens remain escrowed. No administrative release, balance rewrite or expiry. |

The directory makes routine publication and resumption wait two days. Any caller can execute the exact signed and scheduled action before expiry. Two signers can cancel a specific pending digest or suspend discovery immediately. Signing binds action, chain, directory address, nonce and expiry. A single lost or compromised key cannot change discovery. Two compromised keys can publish a malicious future factory after the delay or interrupt discovery. Applications still need independent factory allowlisting and runtime review. No production signer identities or recovery parties are approved. Changes to the immutable signer set require a separately reviewed directory and explicit client repinning.

Factory replacement uses a directory because a proxy with delegatecall retains broad execution power over its storage and future users. UUPS reduces proxy overhead and places authorization in the implementation. A transparent proxy separates the proxy admin but still changes the logic for existing addresses. Neither model constrains a hostile implementation to preserve balances or locks. The directory exposes no delegates, upgrades, arbitrary calls or project asset access. Its storage is explicit for review. A future directory uses a new address and replays reviewed publications without interpreting the old layout. [OpenZeppelin proxy patterns](https://docs.openzeppelin.com/contracts/5.x/api/proxy)

### Same-token asset migration

The original token is the permanent registry key. A creator proposes the exact factory-built successor, its runtime hash and deadline. Two directory signers schedule the EIP-712 digest, with two days of public notice and a bounded execution window. Anyone can execute afterward. Creator cancellation or expiration consumes the nonce. A two-signature discovery suspension stops registration and migration while trading and claims stay open. Already graduated projects are ineligible.

Each asset transfer closes the predecessor, moves exactly the tracked ETH and unsold inventory, initializes the adjacent successor with the same sold and backing values, and moves accrual authority in the original ledger. The factory and registry publish the new version after settlement. Holder balances, supply, economic rules and accrued fee credits retain their original commitments. A revert restores the predecessor and leaves the notice available for retry. Direct donations stay where they arrived, and ERC-20 approvals remain address-scoped. A defect in immutable custody can still prevent recovery. Historical deployments lacking this mechanism cannot be adopted by the new registry.

### Exceptional holder replacement

A creator can prepare a distinct replacement token for an exact registered project and reviewed original runtime. Each holder independently approves their exact amount and redeems 1:1 before a per-request deadline. The escrow takes the old tokens permanently and pays the replacement atomically. A failed transfer leaves both balances and accounting unchanged. Already-graduated LP positions, the project registry, existing curve reserves, fees and old contract address stay on their original terms. A replacement token starts with no inherited curve, liquidity or routing support. Publish and independently review the exact successor and escrow before presenting an opt-in action. Direct transfers to the escrow receive no redemption credit. More than one standalone proposal can exist, and an unredeemed replacement balance has no administrative recovery.

## Reproduction

Use Node 22, pnpm 10.12.1, Foundry 1.7.1 and the checksum-pinned native Solidity 0.8.26 executable. Install the existing pinned v4 dependencies with `bash scripts/install-v4-deps.sh` from `packages/contracts`. Run the curve and directory tests with `forge test --match-path 'test/RMT*Curve*V1.t.sol'`. Run the registry and holder escrow tests with `forge test --match-path 'test/RMTLaunch*{Registry,Migration}V1.t.sol'` from that directory. Run the fork from the repository root.

```sh
node packages/contracts/scripts/validate-curve-graduation-4663.mjs \
  --anvil "$(command -v anvil)" --solc /absolute/path/to/solc-0.8.26 --archive pocket
```

The workflow records compiler inputs, runtime pins, receipts and fork evidence. Its browser job uses a separate 31337 Anvil fork of the pinned Base Sepolia block and an injected browser-wallet fixture. The Curve UI uses explicit loopback enablement and an exact factory, graduation engine and guard runtime pin. Physical wallets and hosted service availability need separate acceptance.

## Release gates

1. Approve the fixed supply presets, virtual parameters, threshold, fee and recipient terms after reviewing the executable simulations. Select independently controlled operating and future reserve recipients. No automatic buybacks or burns.
2. Approve exact chain-specific artifacts, dependency runtime identities, constructor values and immutable bindings. Review the asset-bearing contracts, guard, custody, receipt verification and directory separately. Approve signer independence, delay and incident ownership. No production reviewer is engaged.
3. Approve the indexer, finality and recovery policies for production. Validate hosted routing only for the exact deployed key. Test artifacts and local execution do not establish live provider availability or finality.
