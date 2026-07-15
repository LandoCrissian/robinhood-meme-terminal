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
- [x] Lock every V6 policy to the registry's immutable reviewed market implementation and graduation adapter.
- [x] Implement shared launch gate and reviewed Fair/Open policies.
- [x] Preserve legacy name and symbol protection.
- [x] Implement deterministic pre-graduation fee routing.
- [x] Implement perpetual post-graduation fee accounting and routing.
- [x] Implement permanently locked protocol-owned liquidity accounting.
- [x] Implement permissionless accrued-fee collection.
- [x] Add delayed unpause and policy-governance controls.
- [x] Add V6-only governance with a 24-hour delay, seven-day execution window, cancellation, expiry, public proposal inspection, and permissionless fully approved execution.
- [x] Make signer add/remove/replace and threshold changes atomic; require expiring proof-of-control acceptance bound to the current epoch, exact add-or-replace action, affected signer, and next threshold from every prospective added or replacement signer; let the candidate revoke unconsumed consent before execution; prohibit multi-signer 1-of-N; and advance a configuration epoch that invalidates every older pending proposal, confirmation, and unused acceptance.
- [x] Keep the already-deployed V5 governance limited to the existing version registry; use the new governance for the V6 gate, policy registry, factory payout authority, and splitters.
- [x] Restrict creator-payout changes to delayed RMT governance, RMT treasury, and restoration to the original creator.
- [x] Require governance-only execution, a public evidence hash, and a replay-protection nonce for creator-payout changes; creators have no payout-change action.
- [x] Reject launches from a V6 factory that is no longer active in the version registry.
- [x] Add the exact one-time official RMT migration while ordinary public launches remain paused, permanently bound to legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C` and its expected creator/name/ticker.
- [x] Clamp graduation to the exact net reserve target and isolate refunds, forced assets, and seed dust from liquidity and fees.

## Tests

- [ ] Final contract candidate compiles with the frozen dependency set.
- [x] Factory launch and identity tests.
- [x] Pause blocks every ordinary launch entry point; the exact operator-only official migration remains one-time and non-reopening.
- [x] Guardian cannot schedule reopening or move funds; it may only finalize a governance-authorized reopening after the full gate delay.
- [x] Policy registration is append-only.
- [x] Historical policy data cannot change.
- [x] Registry constructor locks the canonical market implementation and graduation adapter; every policy must use both exact addresses.
- [x] Buy and sell fee accounting.
- [x] Graduation valuation and price continuity.
- [x] Post-graduation fee accounting and routing.
- [x] Liquidity principal cannot be withdrawn.
- [x] External direct liquidity-removal attempts cannot touch the adapter-owned position.
- [x] Canonical V4 pool fee is exactly 0.5% within integer fee-growth rounding.
- [x] Permissionless fee collection cannot redirect proceeds.
- [x] Creator cannot change their payout wallet; governance cannot select an unrelated recipient.
- [x] Governance-delayed payout recovery preserves prior deferred balances and post-graduation fee routing.
- [x] Governance tests cover prospective-signer opt-in and candidate-controlled revocation, exact-transition binding, expiration, missing/wrong/stale acceptance, atomic 1-of-1 to 2-of-2 transition, removal, replacement, stale-proposal non-revival, cancellation, public getters, and permissionless execution.
- [x] Fuzz and invariant tests implemented.
- [ ] Re-run the complete compile, unit, fuzz, invariant, and static-analysis suite after the final payout-authority and hook changes.
- [ ] Final V6 Robinhood mainnet-fork workflow passes on the final release commit.
- [ ] Live fork preflight confirms the existing registry governance, registry, V5 factory, exact official legacy RMT token code/creator/name/ticker, official RMT reservations, PoolManager, and CREATE2 deployer; the foundation rehearsal separately verifies the newly deployed V6 governance.
- [ ] Resolve any PoolManager address/code disagreement; the production RPC must return nonempty bytecode at the address in the official Uniswap deployment list.

## Website and indexer

- [x] Replace ABI-probing launch-style logic with active-factory capabilities.
- [x] Expose one simple flow with the reviewed Fair Start toggle.
- [x] Fail closed for unknown versions, unavailable policies, unhealthy registry, or pause state.
- [x] Preserve read-only terminal, trading, and claims while launch is paused.
- [x] Store policy ID, version, and launch economics per token.
- [x] Display historical economics from launch records, not current defaults.
- [ ] Configure and load-test restricted production RPC endpoints for browser wallet reads, server feeds/health checks, and the archive-capable indexer; verify provider rate and spend limits and failover behavior.

## Deployment

- [ ] Regenerate and review the deployment artifacts from the final compiled V6 contracts; confirm the V6 governance ABI contains both `acceptSignerRole(uint64,uint8,address,uint256,uint64)` and `revokeSignerRoleAcceptance(uint64)` and the wallet console rejects an artifact missing either function.
- [ ] Require the exact artifact-producing CI run to be green before the operator-console deployment; never deploy from the checked-in stale artifact. The Foundry script is fork-rehearsal-only.
- [x] Add wallet-operated phased V6 deployment console.
- [x] Separate foundation deployment, live source verification, and governance proposal submission into distinct fail-closed phases.
- [x] Restrict the Foundry foundation script to fork rehearsal only and ensure it creates zero governance proposals.
- [x] Add fail-closed live dependency and pending-factory checks before the first deployment transaction.
- [x] Read governance proposal IDs from confirmed receipt events.
- [x] Add fail-closed Blockscout verification for all ten V6 contracts plus the existing V5 registry governance, the version registry, and the V5 identity factory.
- [x] Add a seven-address, no-signing-key GitHub workflow that runs the exact source gate on the selected frozen commit and archives its log.
- [x] Recheck all thirteen exact Blockscout records live before every proposal phase and final public reopening; never trust a recovery-file marker.
- [ ] Verify all immutable bindings and fee destinations in the final CI rehearsal, including the factory and migration helper's exact official legacy-token getter.
- [ ] Verify the registry constructor arguments and live canonical-component getters match the exact reviewed market and adapter addresses.
- [ ] Deploy V6 in paused state.
- [ ] Run `scripts/verify-mainnet-v6.sh` after deployment and archive all thirteen successful Blockscout results.
- [ ] Confirm both governance contracts have `transactionCount()` zero before the first proposal. Afterward, prove every ID in both contracts from exact receipts; also verify each V6 proposal through `getTransaction` as current-epoch, uncancelled, and unexpired while pending.
- [ ] Complete independent security review.
- [ ] Propose and activate V6 through the version registry.
- [ ] Confirm production terminal reads V6 and remains paused.
- [ ] Launch and verify the exact official RMT V6 migration while ordinary creation remains paused.
- [ ] Run final health checks.
- [ ] Unpause through delayed governance only after approval.
