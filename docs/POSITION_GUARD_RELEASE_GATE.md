# Position Guard automatic-exit release gate

This document is the operational gate for deploying and enabling RMT's unattended Position Guard exit path. It is intentionally stricter than a successful contract build or a green application test suite.

The executor may be deployed before activation for bytecode verification, but **deployment is not authorization to enable user-facing automatic exits**. The public feature remains disabled until every required item below has durable evidence.

## Release components

A production release binds all of the following as one system:

1. `RMTPositionGuardExecutor` deployed at the deterministic reviewed address.
2. Immutable Robinhood Chain Uniswap V3 factory, SwapRouter02, and WETH addresses.
3. A wallet-registered onchain order containing the exact token, factory-recognized pool, fee tier, protected amount, stop, trailing distance, break-even activation, maximum TWAP slippage, TWAP window, expiry, and one-time order ID.
4. A production Privy policy scoped to Robinhood Chain, the executor, and **only** `checkpointV3Order(bytes32)` plus `executeV3Exit((bytes32,uint256,uint256))`.
5. A dedicated Privy signer and server authorization key. The policy must not allow registration, cancellation, token approval, arbitrary contract calls, arbitrary recipients, or native transfers.
6. The authenticated prepare/arm/cancel API and private Firestore order records.
7. The always-on evaluator heartbeat and lease.
8. Onchain TWAP checkpoints, contract-confirmed trigger state, fresh route quoting, idempotent submission, and receipt-to-order reconciliation.
9. User-facing registration, exact approval, expiry, status, transaction evidence, onchain cancellation, allowance cleanup, signer removal, and recovery controls.

A failure or mismatch in any one component keeps the feature release-locked.

## Current contract boundary

The reviewed candidate executor is ownerless and non-upgradeable. Before delegation is useful, the protected wallet must register an exact order and grant an allowance equal to the protected amount.

The executor can:

- recognize only a token/WETH V3 pool returned by the immutable Uniswap V3 factory;
- record one immutable order for a wallet-selected order ID;
- calculate entry value, high-water mark, stop floor, trailing floor, break-even floor, and minimum output from V3 TWAP observations;
- raise, but never lower, the stored high-water mark;
- require the price to remain at or below the protected floor across a separate block and a bounded confirmation window;
- pull exactly the registered amount only when the wallet balance and allowance still satisfy that order;
- route only through the immutable SwapRouter02 address and registered fee tier;
- send WETH only to the same calling wallet;
- enforce the registered maximum TWAP slippage and a ten-minute deadline ceiling;
- cancel or expire a registered order onchain;
- reject order-ID reuse, reentrancy, pool substitution, unsupported fee-on-transfer behavior, and retained executor balances;
- clear its temporary router allowance after execution.

It cannot select an arbitrary token, pool, fee tier, amount, recipient, or expiry after registration; call an arbitrary contract; charge an RMT fee; receive native currency intentionally; change dependencies; upgrade itself; or withdraw assets through an owner or rescue path.

## Explicit trust boundary

The user grants bounded submission authority over a contract-enforced order. This is materially narrower than the earlier offchain-trigger design, but it is not trustless automation.

The contract independently rejects execution unless the registered TWAP order is active and its confirmation condition is currently satisfied. A compromised policy signer cannot change the order, redirect proceeds, increase the amount, select another pool, loosen slippage, or execute before the contract reports a confirmed trigger.

The evaluator and policy signer still control:

- whether and when high-watermark or confirmation checkpoints are submitted;
- whether an eligible confirmed exit is submitted promptly;
- the wallet gas consumed by policy-allowed checkpoint and execution attempts;
- availability of quote, RPC, Privy, Firestore, and reconciliation infrastructure.

A stopped or malicious evaluator can delay protection. A policy that permits repeated checkpoint calls can consume wallet gas even though it cannot move the protected token. The production policy, monitoring, funding model, and canary must explicitly address that availability and gas-expenditure boundary.

A V3 TWAP reduces single-block spot manipulation risk but does not make a thin, low-observation, manipulated, or illiquid pool safe. Observation cardinality, TWAP lag during fast moves, quote deterioration, pool liveness, and router execution remain release risks. The contract may refuse an exit when the fresh executable quote falls below its TWAP-derived minimum. That is a fail-closed outcome, not guaranteed stop execution.

These limitations must remain visible in the interface and external review scope.

## Required evidence before deployment

Deployment may proceed only after all items are attached to a release record:

- [ ] Exact compiler version, optimizer settings, source commit, artifact hash, init-code hash, salt, expected CREATE2 address, and immutable constructor arguments.
- [ ] `forge fmt --check`, `forge build`, and the complete contract test suite pass from a clean checkout.
- [ ] Mainnet-fork rehearsal registers and cancels the exact reviewed order against the current Robinhood Chain factory, router, WETH, and a live eligible pool without broadcasting.
- [ ] Unit and fuzz evidence covers positive and negative ticks, TWAP arithmetic rounding, token0/token1 orientation, minimum-output math, high-watermark monotonicity, confirmation reset, expiry, cancellation, replay, pool substitution, exact allowance, nonstandard tokens, router reverts, and reentrancy.
- [ ] Static-analysis report reviewed, including every suppression and its rationale.
- [ ] Independent smart-contract review completed by someone other than the implementation author.
- [ ] The reviewer explicitly addresses TWAP manipulation, observation availability, signer gas abuse, checkpoint withholding, quote/TWAP divergence, allowance residue, nonstandard tokens, replay, reentrancy, route identity, cancellation races, and unknown transaction results.
- [ ] The deterministic deployment transaction is simulated against current mainnet state.
- [ ] Required factory, router, WETH, CREATE2 deployer, and RPC code are reverified immediately before signing.

## Required evidence before activation

A deployed executor remains disabled until all items are complete:

- [ ] Blockscout source verification matches the locally reviewed runtime bytecode.
- [ ] Onchain `factory`, `router`, and `weth` values match the release record.
- [ ] Production Privy policy export or screenshot proves chain 4663, the exact executor, only the checkpoint and execute selectors, zero native value, and no broader wallet authority.
- [ ] The policy is tested to reject registration, cancellation, ERC-20 approval, arbitrary calldata, another target, another chain, and an altered recipient or amount.
- [ ] Signer removal has been rehearsed and independently verified.
- [ ] Onchain order cancellation and token approval revocation have both been rehearsed and independently verified.
- [ ] Evaluator heartbeat becomes unhealthy within the documented stale window when the worker stops.
- [ ] New preparation and arming are rejected while the evaluator is unhealthy.
- [ ] Checkpoint and execution submissions are idempotent and bounded; repeated scheduler invocations do not duplicate an attempt.
- [ ] Unknown or timed-out submissions enter `review_required` and are never automatically retried.
- [ ] Production logging excludes bearer tokens, authorization keys, wallet IDs, identity IDs, and full sensitive order records.
- [ ] Monitoring alerts exist for heartbeat failure, checkpoint failure, evaluator errors, review-required orders, failed transactions, stale submitted orders, residual allowance, and onchain/server mismatches.
- [ ] Protection Center can recover an order from a second browser with no local Position Guard storage.
- [ ] User-facing copy shows registered order, asset access, TWAP trigger, route, recipient, expiry, checkpoint evidence, execution status, onchain cancellation, allowance cleanup, signer cleanup, and reconciliation state.

## Bounded canary

The first enabled order must use a dedicated RMT-owned test wallet and an amount whose complete loss is acceptable.

Canary sequence:

1. Fund the embedded wallet with enough native gas for registration, checkpoints, execution or cancellation, approval cleanup, and a failure margin.
2. Acquire a minimal eligible token position and record token balance, WETH balance, native balance, current allowance, signer state, policy ID, and executor.
3. Request a prepared plan and verify the returned token, pool, fee, amount, settings, TWAP window, maximum slippage, expiry, and order ID.
4. Approve the exact amount and register the plan from the wallet.
5. Independently read `getV3Order` and verify every field before adding the policy signer or creating the server record.
6. Prove the evaluator checkpoints a rising high-water mark and cannot move it backward.
7. Prove one below-floor observation enters confirmation without executing in the same block.
8. Prove a recovered price clears confirmation and does not execute.
9. Trigger under the approved controlled procedure and prove a later block reports `Triggered` before the evaluator submits.
10. Confirm WETH arrives only at the protected wallet.
11. Confirm the executor retains no token, WETH, native currency, or router allowance.
12. Confirm the order is `Executed`, the transaction reconciles, and the UI exposes the checkpoint and execution hashes.
13. Confirm the exact executor allowance is zero after execution and remove every additional signer.
14. Repeat a cancellation-only canary: cancel onchain first, clear allowance, remove signers, update the server record, and independently verify all three boundaries.
15. Stop the evaluator during an active canary and verify new arming fails closed while Protection Center still offers cancellation and cleanup.
16. Retain transaction, log, policy, order-state, balance, gas, and revocation evidence in the release record.

No public wallet may arm an automatic exit until the canary has been reviewed and signed off.

## Activation order

Production configuration must be enabled in this order:

1. Deploy and verify the executor.
2. Create and inspect the restricted checkpoint-and-execute Privy policy and signer.
3. Configure server-only authorization and evaluator secrets.
4. Start the evaluator and verify a fresh heartbeat without enabling public arming.
5. Run the bounded canary and cancellation rehearsal.
6. Enable server worker configuration for the approved environment.
7. Enable the public Position Guard flag and exact executor, policy, and signer identifiers.
8. Verify the public UI still fails closed when any required value is absent, stale, mismatched, or not deployed.

Never enable the public flag before the server, policy, executor, evaluator, recovery inventory, and canary are independently healthy.

## Emergency response

Automatic execution must be disabled immediately when any of the following occurs:

- unexpected order registration, checkpoint, execution, cancellation, or recipient behavior;
- signer or authorization-key exposure;
- policy scope mismatch or unexpected gas consumption;
- evaluator heartbeat instability or checkpoint withholding;
- unexplained early execution or server/onchain order mismatch;
- repeated `review_required` transitions;
- incorrect TWAP, floor, quote, price-impact, minimum-output, fee, or deadline behavior;
- router, factory, WETH, RPC, Privy, Firestore, or chain incident;
- inability to cancel the order, remove signer authority, or clear allowance reliably.

Response order:

1. Disable worker and public feature flags.
2. Stop new checkpoint and execution submission while preserving transaction receipt reconciliation.
3. Notify affected users to cancel active executor orders onchain, clear executor allowances, and remove app signers.
4. Identify every active, executing, submitted, expired-with-allowance, and review-required order.
5. Reconcile every known transaction hash before any retry or reactivation.
6. Verify every affected order status and wallet allowance directly onchain.
7. Publish a factual incident record and corrective release gate.

Because the executor is ownerless, it cannot be globally paused onchain. Each wallet can cancel its own registered order and clear allowance. Operational shutdown additionally depends on disabling the policy signer and evaluator. That limitation is part of the release decision, not an implementation detail to omit.

## Evidence record template

Each release record should contain:

- source commit and PR;
- contract source, creation, runtime, ABI, and library hashes;
- deterministic address calculation;
- deployment transaction and receipt;
- Blockscout verification link;
- immutable dependency reads;
- external review and static-analysis reports;
- unit, fuzz, invariant, and mainnet-fork outputs;
- Privy policy, negative-policy tests, and signer evidence;
- evaluator heartbeat, checkpoint, idempotency, and failure rehearsals;
- canary prepared plan, registered order, checkpoint transactions, execution or cancellation, balances, gas, and cleanup evidence;
- Protection Center cross-device recovery evidence;
- approver names, date, and explicit go/no-go decision.

Until that record is complete, the correct release state is **deployed candidate, automatic execution disabled**.
