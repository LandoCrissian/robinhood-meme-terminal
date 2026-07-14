# V6 Release Checklist

Public token creation remains paused until every required item is complete.

## Architecture

- [x] Stable V6 factory capability interface defined.
- [x] Append-only launch policy interface defined.
- [x] Website capability model defined.
- [x] V6 protocol foundation documented.
- [x] Implement the candidate post-graduation fee mechanism for Robinhood Chain's Uniswap V4 deployment.
- [ ] Complete an independent review of the final candidate commit.

## Contracts

- [x] Implement append-only policy registry.
- [x] Implement shared launch gate and reviewed Fair/Open policies.
- [x] Preserve legacy name and symbol protection.
- [x] Implement deterministic pre-graduation fee routing.
- [x] Implement perpetual post-graduation fee accounting and routing.
- [x] Implement permanently locked protocol-owned liquidity accounting.
- [x] Implement permissionless accrued-fee collection.
- [x] Add delayed unpause and policy-governance controls.

## Tests

- [x] Compile all contracts.
- [x] Factory launch and identity tests.
- [x] Pause blocks every launch entry point.
- [x] Guardian cannot unpause or move funds.
- [x] Policy registration is append-only.
- [x] Historical policy data cannot change.
- [x] Buy and sell fee accounting.
- [x] Graduation valuation and price continuity.
- [x] Post-graduation fee accounting and routing.
- [x] Liquidity principal cannot be withdrawn.
- [x] Permissionless fee collection cannot redirect proceeds.
- [x] Fuzz and invariant coverage.
- [ ] Final V6 Robinhood mainnet-fork workflow passes on the release commit.

## Website and indexer

- [x] Replace ABI-probing launch-style logic with active-factory capabilities.
- [x] Expose one simple flow with the reviewed Fair Start toggle.
- [x] Fail closed for unknown versions, unavailable policies, unhealthy registry, or pause state.
- [x] Preserve read-only terminal, trading, and claims while launch is paused.
- [x] Store policy ID, version, and launch economics per token.
- [x] Display historical economics from launch records, not current defaults.

## Deployment

- [x] Generate reproducible deployment artifacts.
- [x] Add wallet-operated phased V6 deployment console.
- [x] Verify all immutable bindings and fee destinations in code and rehearsal.
- [ ] Deploy V6 in paused state.
- [ ] Verify source code.
- [ ] Complete independent security review.
- [ ] Propose and activate V6 through the version registry.
- [ ] Confirm production terminal reads V6 and remains paused.
- [ ] Run final health checks.
- [ ] Unpause through delayed governance only after approval.
