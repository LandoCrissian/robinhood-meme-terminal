# Guarded V2 validation on the Robinhood 4663 fork

The starting draft was #583 at `648bf05eb30664ef25c5d006cb90a5480fd39394`. Every tracked Solidity file matches `69cfaa392e488f475b8b1e15a34c0ac986abd24e`. The contract source tree is `f0d132e63fcba8d2e354f5abe5a72ad46ac3dc0b`. All writes in this evidence are simulated by loopback Anvil. The shipping launchpad remains gated to chain 31337 and Growth remains fixture-only. [Frozen source and review scope](RMT_LAUNCH_RELEASE_CANDIDATE.md#final-source-manifest)

## Reproduce the review inputs

Use Node 22, pnpm 10.12.1, Foundry 1.7.1, pinned v4 dependencies and native Solidity `0.8.26+commit.8a97fa7a`. The harness checks the compiler executable and every dependency source checksum. The review changes the deployer constructor's chain check and the ledger's inherited chain constant in compiler input. The compiler profiles use identical Cancun, via-IR and optimizer settings. [Compiler and dependency provenance](RMT_ROBINHOOD_4663_PROVENANCE.md#offline-review-build)

```sh
pnpm install --frozen-lockfile
(cd packages/contracts && bash scripts/install-v4-deps.sh)
(cd apps/web && node --import tsx ../../packages/contracts/scripts/validate-launch-4663-fork.mjs \
  --anvil "$(command -v anvil)" --solc /absolute/path/to/solc-0.8.26) > /tmp/robinhood-4663-fork-evidence.json
```

The standard JSON input SHA-256 values are `e417872870cebed4dd1aa9c39b929004ee8ef7e60fd2a5dda8087574a825e579` for the 31337 comparison and `2d0d984528ebc11d7e43ac1645565ff492be4bef94691a2b451df2e33ee31318` for the 4663 review. A fresh Windows compile matched the independently reproduced #583 Linux manifest on inputs, templates and immutable offsets. The complete manifest hashes differ by compiler executable identity and platform. [Independent Linux manifest](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43444195883/artifacts/14048040740)

| 4663 contract | Creation template SHA-256 | Runtime template SHA-256 |
| --- | --- | --- |
| V2 deployment | `47db9801cdd296c65e52e32288209e900834ae6821b7cd20d9f316a216ede5ef` | `a409627aed782ce31045679ac53e2c27cc23d014c7e6fc1d924ce6e8b273472f` |
| Initialization guard | `cc49723d0867bdace58cc6356fb14dbfbd9aa5565107610e48adb2e9e4493fed` | `7adeaa09ebc47ea29d4ddd601d9ef05d382349b9d64da377bf4bd1505023e58d` |
| V2 factory and inherited ledger | `b6d9f3aa2d366588953d008e3a04ab99cc72358005f515fe09264454c5099139` | `3890c7d9c550ec9f3302b45c05c531d8399aea7b3048b11437117c83f7e6ef03` |
| Fixed-supply token | `af74d57cace249238f706c73adb615b4898234e3645f4ec45579e6300b165032` | `bdb5d8dede2d89bcc88820df47e5e116c8c0ec2a5fc0958bf858bea9b8410249` |

## Canonical fork and dependencies

The pinned Robinhood block is `113412054`, hash `0x17252a232b68a4e9fc494caf0660cff722ac2da966ee5c62b40e20dbcfd32ea2`, timestamp `2026-11-13T14:08:02Z`. dRPC, Pinax and the official RPC return the same header and state root. The official RPC returns `-32000` for historical Router 2.1.2 bytecode at this anchor. Pinax served the bytecode but returned HTTP `429` during fork account reads. The harness uses dRPC for the entire execution fork and independently corroborates the anchor on the official RPC. The [dependency manifest](RMT_ROBINHOOD_4663_PROVENANCE.md#observed-dependency-identities) records PoolManager, PositionManager, Permit2, Quoter, StateView and Universal Router 2.1.2 runtime hashes and constructor bindings. [Official Uniswap pins](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663), [Robinhood RPC providers](https://docs.robinhood.com/chain/connecting/), [dRPC Robinhood endpoint](https://drpc.org/chainlist/robinhood-mainnet-rpc)

The harness starts Anvil on an operating-system assigned `127.0.0.1` port with zero unlocked keys. It gives deterministic synthetic addresses local balances and impersonates them inside Anvil. An independent loopback proxy forwards only explicitly enumerated read methods to the selected archive. Its negative write probe is rejected locally before forwarding. dRPC's optional `eth_getAccountInfo` returned `-32601`, and a direct `eth_getProof` probe returned `27` (`Unknown state`) at the anchor. Anvil used ordinary account and storage reads. Fork receipts, block hashes and addresses describe the isolated simulation.

## Release review still required

- Review both `_fundPosition` helpers, including the V1 Slither IR failure and the separately observed V2 `deadline.toUint48()` IR failure. Both affect the temporary allowance, exact settlement and custody analysis. The high-severity gate does not measure complete IR coverage. [Review scope and exact gaps](RMT_LAUNCH_RELEASE_CANDIDATE.md#independent-review-coverage)
- Review the unchanged lockfile's nine moderate and two low production advisories. The Hono advisories cover `hono` through `4.13.15` and `@hono/node-server` below `2.1.6`. Record the remediation or acceptance decision separately. [Hono advisory](https://github.com/advisories/GHSA-4m76-xfj5-7975), [Node adapter advisory](https://github.com/advisories/GHSA-jpvv-r467-5p4w)
- Approve exact constructor values, operational deployer and guard salt, immutable runtime identity, and core launch economics. Review the target-chain wallet/RPC, trace retention and durable indexer/finality policy. Anvil executes the pinned state locally with the Cancun EVM. Its call traces, block production, gas and checkpoint recovery do not establish Nitro sequencer or L1 data-fee behavior. [Economics and decisions](RMT_LAUNCH_RELEASE_CANDIDATE.md#core-economics-decision-sheet), [4663 release checklist](RMT_ROBINHOOD_4663_PROVENANCE.md#release-evidence-still-required)
- Hosted indexing and routing for the full guarded PoolKey remain unknown. Growth has a separate release decision. The production target, review engagement and release each require owner approval.
