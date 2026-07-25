# PoH Core v0.1 Manifest

## Solidity implementation

- `src/ProofOfHoldingToken.sol` — fixed-supply reference ERC-20 and immutable accounting hook.
- `src/LoyaltyAccounting.sol` — transfer-aware position state and exclusion governance.
- `src/PoHPolicyV1.sol` — stateless square-root multiplier policy.
- `src/interfaces/IProofOfHoldingCore.sol` — objective holding-state interface and events.
- `src/interfaces/IPoHPolicy.sol` — policy interface.

## Solidity verification

- `test/LoyaltyAccounting.t.sol` — deterministic and fuzz transition tests.
- `test/LoyaltyAccountingInvariant.t.sol` — stateful balance, supply, and timestamp invariants.
- `test/PoHPolicyV1.t.sol` — policy bounds and monotonicity.
- `test/TestBase.sol` — minimal Foundry test harness.

## Independent model

- `simulation/poh_model.py` — independent integer state machine.
- `simulation/test_poh_model.py` — seven model tests, including 50,000 randomized operations.

## Engineering documents

- `docs/POH-CORE-SPEC-v0.1.md` — normative draft behavior and formulas.
- `docs/THREAT-MODEL.md` — assets, trust boundaries, threats, controls, and launch blockers.

## Reproducibility

- `foundry.toml` pins Solidity `0.8.36` and test parameters.
- `remappings.txt` pins the import path expected for OpenZeppelin Contracts `v5.6.1`.
- `.github/workflows/poh-core.yml` pins the GitHub action revisions used by the incubator branch.
- `LICENSE` is MIT.

## Security status

The implementation has passed its included automated suites but has not received an external
security audit. The package is an engineering prototype, not a mainnet release artifact.
