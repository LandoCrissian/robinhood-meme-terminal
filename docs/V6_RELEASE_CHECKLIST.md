# V6 Release Checklist

Current production status: **the official V6 market is live; new V6 token creation is closed under RMT's terminal product direction**. This is the historical release plan, not proof that every planned gate was completed. Its unchecked deployment and verification items remain unchecked deliberately. Use [MAINNET_V6_DEPLOYMENT.md](MAINNET_V6_DEPLOYMENT.md) for confirmed addresses and receipts; exact source publication and the independent human audit remain open work.

## Architecture

- [x] Stable V6 factory capability interface defined.
- [x] Append-only launch policy interface defined.
- [x] Website capability model defined.
- [x] V6 protocol foundation documented.
- [x] Implement the candidate post-graduation fee mechanism for Robinhood Chain's Uniswap V4 deployment.
- [x] Publish an explicit unaudited-mainnet-beta disclosure; retain an independent audit as the first funded post-launch security priority.

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
- [x] Use one fresh V6 governance contract as protocol authority and protocol treasury; govern a fresh registry initialized to the legacy V5 factory/version, with no V6 dependency on legacy governance or the old registry.
- [x] Restrict creator-payout destinations to the V6 governance treasury and restoration to the original creator.
- [x] Require a signer-approved delayed governance proposal, public evidence hash, and replay-protection nonce for creator-payout changes; creators cannot authorize, propose, choose, or directly change a recipient, while any account may relay the exact approved call after the delay.
- [x] Reject launches from a V6 factory that is no longer active in the version registry.
- [x] Add the exact one-time official RMT migration while ordinary public launches remain paused, permanently bound to legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C` and its expected creator/name/ticker.
- [x] Clamp graduation to the exact net reserve target and isolate refunds, forced assets, and seed dust from liquidity and fees.
- [x] Constructor-install only the exact Fair/Open V1 policies and Fair default.
- [x] Add a chain-4663-only, operator-only, pristine-governance, 12-hour bootstrap controller with no generic call, asset custody, upgrade, or reusable admin authority.
- [x] Split the controller's topology and smoke checks into two immutable, controller-bound, read-only verifier children so every runtime and the controller initcode remain below protocol size limits.
- [x] Require the controller to prove the exact topology, official RMT as launch zero, and a genuine pre-graduation fully settled curve-fee smoke buy before one-time public opening; retain independent replay latches in the controller, registry, gate, and identity migration.
- [x] Bind registry, gate, and policy schedules to the live governance configuration epoch and expire them seven days after their target delay; allow delayed governance to rotate gate and policy guardians.

## Tests

- [x] Final contract candidate compiles with the frozen dependency set.
- [x] Factory launch and identity tests.
- [x] Pause blocks every ordinary launch entry point; the exact operator-only official migration remains one-time and non-reopening.
- [x] Guardian cannot schedule reopening or move funds; it may only finalize a governance-authorized reopening after the full gate delay.
- [x] Genesis bootstrap activation/opening is one-use and expiring; every later registry change and later reopening retains the permanent delays.
- [x] Policy registration is append-only.
- [x] Historical policy data cannot change.
- [x] Registry constructor locks the canonical market implementation and graduation adapter; every policy must use both exact addresses.
- [x] Buy and sell fee accounting.
- [x] Graduation valuation and price continuity.
- [x] Post-graduation fee accounting and routing.
- [x] Liquidity principal cannot be withdrawn.
- [x] External direct liquidity-removal attempts cannot touch the adapter-owned position.
- [x] Canonical Uniswap v4 pool fee is exactly 0.5% within integer fee-growth rounding.
- [x] Permissionless fee collection cannot redirect proceeds.
- [x] Creator cannot change their payout wallet; governance cannot select an unrelated recipient.
- [x] Governance-delayed payout recovery preserves prior deferred balances and post-graduation fee routing.
- [x] Governance tests cover prospective-signer opt-in and candidate-controlled revocation, exact-transition binding, expiration, missing/wrong/stale acceptance, atomic 1-of-1 to 2-of-2 transition, removal, replacement, stale-proposal non-revival, cancellation, public getters, and permissionless execution.
- [x] Fuzz and invariant tests implemented.
- [ ] Re-run the complete compile, unit, fuzz, invariant, and static-analysis suite after the final payout-authority and hook changes.
- [ ] Final V6 Robinhood mainnet-fork workflow passes on the final release commit.
- [ ] Live fork preflight confirms the V5 identity factory, exact official legacy RMT token code/creator/name/ticker, official RMT reservations, PoolManager, and CREATE2 deployer; the foundation rehearsal separately verifies the newly deployed V6 governance/treasury and fresh V6-governed registry initialized to V5.
- [ ] Resolve any PoolManager address/code disagreement; the production RPC must return nonempty bytecode at the address in the official Uniswap deployment list.

## Website and indexer

- [x] Replace ABI-probing launch-style logic with active-factory capabilities.
- [x] Expose one simple flow with the reviewed Fair Start toggle.
- [x] Fail closed for unknown versions, unavailable policies, unhealthy registry, or pause state.
- [x] Preserve read-only terminal, trading, and claims while launch is paused.
- [x] Store policy ID, version, and launch economics per token.
- [x] Display historical economics from launch records, not current defaults.
- [x] Keep the known V5 registry/feed readable before cutover, then fail closed for V6 unless a fresh registry and exact V6 factory deployment block are explicitly configured.
- [x] Publish registry, active factory/version, start block, and configuration-validity evidence from `/api/health`.
- [ ] Configure and load-test restricted production RPC endpoints for browser wallet reads, server feeds/health checks, and the archive-capable indexer; verify provider rate and spend limits and failover behavior.

## Deployment

- [x] Regenerate and review the deployment artifacts from the final compiled V6 contracts; confirm the V6 governance ABI contains both `acceptSignerRole(uint64,uint8,address,uint256,uint64)` and `revokeSignerRoleAcceptance(uint64)` and the wallet console rejects an artifact missing either function.
- [ ] Require the exact artifact-producing CI run to be green before the operator-console deployment; never deploy from the checked-in stale artifact. The Foundry script is fork-rehearsal-only.
- [x] Add wallet-operated phased V6 deployment console.
- [x] Separate paused foundation deployment, live source verification, one-time activation, production cutover, official launch/smoke, and final opening into distinct fail-closed phases.
- [x] Restrict the Foundry foundation script to fork rehearsal only and ensure it creates zero governance proposals.
- [x] Add fail-closed legacy identity/dependency checks before deployment and fresh-registry owner/initial-state checks immediately after deployment.
- [x] Add fail-closed Blockscout verification for all fourteen V6 contracts, including the bootstrap controller, both immutable verifier children, and fresh registry, plus the V5 identity factory.
- [x] Add a nine-address, no-signing-key GitHub workflow that runs the exact source gate on the selected frozen commit and archives its log.
- [x] Recheck all fifteen exact Blockscout records live before activation and final public reopening; never trust a recovery-file marker.
- [ ] Verify all immutable bindings and fee destinations in the final CI rehearsal, including the factory and migration helper's exact official legacy-token getter.
- [ ] Verify the registry constructor arguments and live canonical-component getters match the exact reviewed market and adapter addresses.
- [ ] Deploy V6 in paused state.
- [ ] Run `scripts/verify-mainnet-v6.sh` after deployment and archive all fifteen successful Blockscout results.
- [ ] Confirm the one V6 governance contract remains at epoch 1 with `transactionCount()` zero throughout the expedited bootstrap.
- [ ] Before the 12-hour window expires, activate only the exact source-verified V6 factory through the one-time controller and confirm public launches remain paused.
- [ ] Set production `NEXT_PUBLIC_VERSION_REGISTRY_ADDRESS` to the fresh V6-governed registry, `NEXT_PUBLIC_FACTORY_START_BLOCK` to the exact confirmed V6 factory deployment block, and `NEXT_PUBLIC_APP_URL` to the exact public HTTPS origin; redeploy and confirm `/api/health` publishes those exact values.
- [ ] Confirm production terminal reads V6 from that block and remains paused.
- [ ] Before signing, disclose that the official V6 launch creates a new token contract/address and new one-billion-token supply and does not copy, swap, credit, or migrate old V5 balances; then launch and verify it while ordinary creation remains paused.
- [ ] Wait one Fair Start block, make a small official RMT buy, and prove nonzero fully paid 70/30 curve fees with no pending operator or governance payout.
- [ ] Run final health checks and confirm the operator console rejects local/preview, legacy-registry, stale-factory, wrong-version, wrong-start-block, unhealthy, stale, zero-fee, duplicate-launch, or expired-bootstrap states.
- [ ] Permanently consume the one-time controller and open public creation; verify all later reopenings and upgrades still require the permanent delays.
- [ ] Complete an independent human audit as the first funded post-launch security priority.
