# PoH Protocol v0.1 Manifest

## Solidity implementation

- `src/ProofOfHoldingToken.sol` — fixed-supply reference ERC-20 and immutable accounting hook.
- `src/LoyaltyAccounting.sol` — transfer-aware position state and exclusion governance.
- `src/PoHPolicyV1.sol` — stateless square-root multiplier policy.
- `src/interfaces/IProofOfHoldingCore.sol` — objective holding-state interface and events.
- `src/interfaces/IPoHPolicy.sol` — policy interface.
- `src/interfaces/IPoHEpochRewards.sol` — standardized funded Merkle-epoch interface.
- `src/rewards/EpochRewardsDistributor.sol` — review-delayed, fully reserved ERC-20 reward claims.

## Solidity verification

- `test/LoyaltyAccounting.t.sol` — deterministic and fuzz transition tests.
- `test/LoyaltyAccountingInvariant.t.sol` — stateful balance, supply, and timestamp invariants.
- `test/PoHPolicyV1.t.sol` — policy bounds and monotonicity.
- `test/EpochRewardsDistributor.t.sol` — epoch lifecycle, proof, funding, payout, and replay tests.
- `test/EpochRewardsInvariant.t.sol` — stateful collateralization, allocation, and epoch-order invariants.
- `test/mocks/MockRewardToken.sol` — exact-transfer reward-token fixture.
- `test/mocks/MockOutboundFeeToken.sol` — adversarial underpayment fixture.
- `test/TestBase.sol` — minimal Foundry test and cheatcode harness.

## Independent models

- `simulation/poh_model.py` — independent integer holding-state machine.
- `simulation/test_poh_model.py` — seven holding-model tests, including 50,000 operations.
- `simulation/rewards_model.py` — independent reserve and epoch-lifecycle model.
- `simulation/test_rewards_model.py` — six reward-model tests, including 50,000 operations.

## Engineering documents

- `docs/POH-CORE-SPEC-v0.1.md` — normative holding behavior and formulas.
- `docs/THREAT-MODEL.md` — PoH Core assets, trust boundaries, threats, and controls.
- `docs/POH-EPOCH-REWARDS-SPEC-v0.1.md` — funded epoch, leaf, claim, and rollover rules.
- `docs/EPOCH-REWARDS-THREAT-MODEL.md` — reward assets, trust boundaries, threats, and controls.

## Reproducibility

- `foundry.toml` pins Solidity `0.8.36`, fuzzing, invariant, and formatting parameters.
- `remappings.txt` pins the import path expected for OpenZeppelin Contracts `v5.6.1`.
- `.github/workflows/poh-core.yml` pins GitHub action revisions and runs read-only verification.
- `LICENSE` is MIT.

## Verified automated scope

- `forge fmt --check`;
- `forge build --sizes`;
- forty-two Solidity test functions;
- 2,000-run fuzz configuration;
- two stateful invariant suites configured for 512 runs at depth 128;
- thirteen Python model tests;
- two deterministic 50,000-operation state simulations;
- repository secret scan.

## Security status

The implementation has passed its included automated suites but has not received an external
security audit. The package is an engineering prototype, not a mainnet release artifact. The
Merkle review delay mitigates operational mistakes but does not cryptographically prove that a
publisher's dataset or root is correct.
