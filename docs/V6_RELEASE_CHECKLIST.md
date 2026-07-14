# V6 Release Checklist

Public token creation remains paused until every required item is complete.

## Architecture

- [x] Stable V6 factory capability interface defined.
- [x] Append-only launch policy interface defined.
- [x] Website capability model defined.
- [x] V6 protocol foundation documented.
- [ ] Finalize audited post-graduation fee mechanism for Robinhood Chain's Uniswap V4 deployment.

## Contracts

- [ ] Implement append-only policy registry.
- [ ] Implement pausable V6 factory with one public `SIMPLE_V1` policy.
- [ ] Preserve legacy name and symbol protection.
- [ ] Implement deterministic pre-graduation fee routing.
- [ ] Implement perpetual post-graduation fee accounting and routing.
- [ ] Implement permanently locked protocol-owned liquidity accounting.
- [ ] Implement permissionless accrued-fee collection.
- [ ] Add delayed unpause and policy-governance controls.

## Tests

- [ ] Compile all contracts.
- [ ] Factory launch and identity tests.
- [ ] Pause blocks every launch entry point.
- [ ] Guardian cannot unpause or move funds.
- [ ] Policy registration is append-only.
- [ ] Historical policy data cannot change.
- [ ] Buy and sell fee accounting.
- [ ] Graduation valuation and price continuity.
- [ ] Post-graduation fee accounting and routing.
- [ ] Liquidity principal cannot be withdrawn.
- [ ] Permissionless fee collection cannot redirect proceeds.
- [ ] Fuzz and invariant coverage.

## Website and indexer

- [ ] Replace ABI-probing launch-style logic with active-factory capabilities.
- [ ] Expose only the default simple policy for V6.
- [ ] Fail closed for unknown versions, unavailable policies, unhealthy registry, or pause state.
- [ ] Preserve read-only terminal, trading, and claims while launch is paused.
- [ ] Store policy ID, version, and launch economics per token.
- [ ] Display historical economics from launch records, not current defaults.

## Deployment

- [ ] Generate reproducible deployment artifacts.
- [ ] Add wallet-operated V6 deployment console.
- [ ] Verify all immutable bindings and purpose destinations.
- [ ] Deploy V6 in paused state.
- [ ] Verify source code.
- [ ] Complete independent security review.
- [ ] Propose and activate V6 through the version registry.
- [ ] Confirm production terminal reads V6 and remains paused.
- [ ] Run final health checks.
- [ ] Unpause through delayed governance only after approval.
