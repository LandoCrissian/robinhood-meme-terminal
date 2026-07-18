# RMT Liquidity Rescue

RMT Liquidity Rescue is a research prototype for consolidating voluntarily migrated, fragmented liquidity into one Robinhood Chain WETH market. It does not search for or seize assets. A token holder, LP owner, or project must exit an old position externally and voluntarily transfer the resulting approved settlement asset through a separately reviewed route.

The first implementation is intentionally isolated from the live V6 launch factory, markets, governance bootstrap, and permanent graduation position. The vault bytecode is hard-gated to Robinhood Chain testnet (`46630`), is not deployed, must not receive real-value assets, and is not an official Sushi or Robinhood product or partnership.

## Product objective

Many launchpads produce separate tokens or shallow pools with the same ticker. Repeating that pattern across chains divides liquidity further. Liquidity Rescue uses a hub-and-spoke model instead:

1. An owner exits or converts an old position outside RMT on its source chain.
2. A proposed, independently reviewed bridge route moves an approved settlement asset directly to Robinhood Chain.
3. A future bridge-specific intake adapter verifies the source message and contributes canonical Robinhood Chain WETH to the destination vault.
4. The vault credits the beneficiary and records the source chain, source pool, and unique migration identifier.
5. Once the campaign meets its minimum and receives the governance-funded paired token, deposits are paused and governance must commit the exact credited balances before invoking the fixed seeder.
6. A future concrete seeder must prove the canonical pool, bounded execution price, minted position, and actual custodian ownership. The generic prototype interface cannot prove those facts by itself.

No design should daisy-chain funds through multiple bridges. Every additional bridge adds cost, latency, and another failure domain.

## Implemented contracts

### `RMTLiquidityRescueVault`

The destination vault provides:

- native ETH on Robinhood Chain wrapping into the configured canonical WETH;
- direct WETH contribution with beneficiary attribution;
- capped bridge-adapter intake with each adapter bound to one configured source chain;
- source-chain and global WETH caps;
- replay keys domain-separated by destination chain, vault, adapter, source chain, source pool, and migration identifier;
- exact-balance checks that reject fee-on-transfer or malformed token behavior;
- separate accounting for WETH contributors and paired-token funders;
- governance-only paired-token funding;
- an immediate guardian pause and one-way guardian cancellation;
- governance-only reactivation, source admission, adapter admission, and finalization;
- finalization only while paused and only for an exact credited-balance snapshot;
- exclusion of unsolicited ERC-20 balances from the seeded amounts;
- permissionless cancellation after the funding deadline;
- claim-based contributor refunds if the campaign is cancelled or expires;
- all-or-nothing credited-amount transfer through one fixed liquidity seeder and custodian address;
- a constructor-enforced Robinhood Chain testnet-only gate;
- no proxy, upgrade, arbitrary call, generic token sweep, bridge call, or liquidity withdrawal method.

### `ILiquidityRescueSeeder`

The vault depends on a narrow fixed interface rather than embedding a guessed DEX integration. No concrete Sushi seeder is implemented. A reviewed Sushi implementation can be added only after the canonical Robinhood Chain pool contracts and supported initialization path are confirmed.

The prototype checks exact credited-amount consumption plus nonzero self-reported position and liquidity values. A malicious or misconfigured seeder could still misdirect every approved token or fabricate those return values. A production seeder must bind known DEX contracts and code, enforce pool and price bounds, verify the real position onchain, and prove its owner is the configured custodian. This is a mainnet blocker, not a completed guarantee.

## Contributor rights are not designed yet

The current credits are refund liabilities before finalization; they are not LP shares, receipt tokens, redemption rights, or fee claims. After prototype finalization, the configured custodian controls whatever position the future seeder actually creates. RMT must define and implement enforceable ownership, redemption, revenue, and governance rights before accepting any real-value contribution. Until then, the module is testnet research only.

## Trust and safety boundary

The destination vault does **not** prove owner authorization or activity on another chain. Each admitted bridge adapter asserts the beneficiary and must independently prove all of the following:

- the source chain and bridge route are supported;
- the source transaction is final under that chain's security model;
- the represented assets were controlled and voluntarily migrated by the beneficiary or project;
- the source pool identifier and migration identifier are canonical;
- the destination WETH was actually received;
- the message cannot be replayed, reordered into a different campaign, or redirected to another beneficiary.

Adapters must be reviewed independently and enabled through the configured governance contract. The intended production governance must be a separately verified timelock; the vault only verifies that the immutable governance address contains code and does not enforce a delay itself. A generic adapter that trusts arbitrary calldata is forbidden.

## Pairing with ETH on Robinhood Chain

Robinhood Chain uses ETH as its native gas asset. The mainnet canonical WETH address published by Robinhood is `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`. Testnet deployments must use the independently verified testnet WETH address supplied through the deployment environment; the script deliberately does not guess it.

The proposed destination pool is one paired-token/WETH market. RMT and any future Sushi route should use that same liquidity instead of deploying duplicate tokens or competing pools.

## Testnet deployment

The deployment script requires existing, reviewed components:

```text
DEPLOYER_PRIVATE_KEY
RESCUE_GOVERNANCE
RESCUE_GUARDIAN
RESCUE_WETH
RESCUE_PAIRED_TOKEN
RESCUE_LIQUIDITY_SEEDER
RESCUE_LIQUIDITY_CUSTODIAN
RESCUE_GLOBAL_WETH_CAP
RESCUE_MINIMUM_WETH
RESCUE_FUNDING_DURATION
```

Run only on Robinhood Chain testnet (`46630`):

```bash
forge script script/DeployLiquidityRescueTestnet.s.sol:DeployLiquidityRescueTestnet \
  --rpc-url robinhood_testnet \
  --broadcast
```

Do not deploy even on testnet until the seeder, WETH address, fixed-balance paired token, governance, guardian, and contract-based custodian have been separately verified. Testnet deployment is a rehearsal, not permission to accept real-value assets.

## Mainnet blockers

- Sushi confirmation of the canonical pool creation and position-management contracts.
- Concrete seeder verification of canonical pool identity, price bounds, position ownership, and actual liquidity.
- One bridge-specific adapter and adversarial tests for each admitted route.
- Source-chain finality, reorg, replay, and refund handling.
- Reliable asset valuation and slippage policy for converting old LP assets to WETH.
- Enforceable contributor ownership, receipt, redemption, fee, and governance rights after finalization.
- Verified timelocked governance and a reviewed contract-based liquidity custodian.
- Campaign eligibility, per-participant limits, and source-cap reservation policy.
- Fixed-balance, non-rebasing, non-blacklisting token requirements and solvency invariants.
- Economic and legal review of contributor rights, incentives, fees, and disclosures.
- Independent audit of the vault, every adapter, the seeder, and the complete deployment configuration.
- Robinhood Chain testnet rehearsal with failure recovery and explorer-verified source.

Until those blockers are complete, the module is a testnet-only research prototype, not a reviewed production protocol or a promise that fragmented liquidity can be recovered or profitably redeployed.
