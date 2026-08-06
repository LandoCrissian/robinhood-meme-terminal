# Position Guard automatic-exit release gate

This document is the operational gate for deploying and enabling RMT's unattended Position Guard exit path. It is intentionally stricter than a successful contract build or a green application test suite.

The executor may be deployed before activation for bytecode verification, but **deployment is not authorization to enable user-facing automatic exits**. The public feature remains disabled until every required item below has durable evidence.

## Release components

A production release binds all of the following as one system:

1. `RMTPositionGuardExecutor` deployed at the deterministic reviewed address.
2. Immutable Robinhood Chain Uniswap V3 factory, SwapRouter02, and WETH addresses.
3. A production Privy policy scoped to Robinhood Chain, the executor, and `executeV3Exit` only.
4. A dedicated Privy signer and server authorization key.
5. The authenticated order API and private Firestore order records.
6. The always-on evaluator heartbeat and lease.
7. Quote generation, trigger confirmation, idempotent submission, and receipt reconciliation.
8. The user-facing approval, expiry, status, transaction evidence, and revocation controls.

A failure or mismatch in any one component keeps the feature release-locked.

## Current contract boundary

The reviewed candidate executor is ownerless and non-upgradeable. It can:

- pull no more than a caller-approved token amount;
- use only a factory-confirmed token/WETH V3 pool;
- route through the immutable SwapRouter02 address;
- send WETH only to the same calling wallet;
- enforce a nonzero minimum output, a maximum 5% slippage setting, and a ten-minute deadline ceiling;
- consume an order identifier once;
- reject reentrancy and unsupported fee-on-transfer or rebasing behavior;
- clear its temporary router allowance after execution.

It cannot select an arbitrary recipient, call an arbitrary contract, charge an RMT fee, receive native currency intentionally, change dependencies, upgrade itself, or withdraw assets through an owner or rescue path.

## Explicit trust boundary

The user grants a bounded delegation, not a fully onchain stop order.

The RMT evaluator and policy signer determine when a valid executor call is submitted. A compromised signer could submit an exit early while the allowance and signer remain active. The executor still prevents redirected proceeds and cannot spend beyond the token approval, but it does not independently prove the offchain stop-loss or trailing-stop condition.

Spot-price and quote manipulation remain release risks, especially in thin pools. The present minimum-output and price-impact controls bound one transaction; they do not make a manipulated or illiquid market safe.

These limitations must remain visible in the interface and external review scope.

## Required evidence before deployment

Deployment may proceed only after all items are attached to a release record:

- [ ] Exact compiler version, optimizer settings, source commit, artifact hash, init-code hash, salt, expected CREATE2 address, and immutable constructor arguments.
- [ ] `forge fmt --check`, `forge build`, and the complete contract test suite pass from a clean checkout.
- [ ] Mainnet-fork rehearsal passes against the exact current Robinhood Chain factory, router, quoter, WETH, and a live eligible pool without broadcasting.
- [ ] Static-analysis report reviewed, including any suppressions and their rationale.
- [ ] Independent smart-contract review completed by someone other than the implementation author.
- [ ] The reviewer explicitly addresses spot manipulation, signer compromise, allowance residue after balance changes, nonstandard tokens, replay, reentrancy, route identity, and unknown transaction results.
- [ ] The deterministic deployment transaction is simulated against current mainnet state.
- [ ] Required factory, router, WETH, CREATE2 deployer, and RPC code are reverified immediately before signing.

## Required evidence before activation

A deployed executor remains disabled until all items are complete:

- [ ] Blockscout source verification matches the locally reviewed runtime bytecode.
- [ ] Onchain `factory`, `router`, and `weth` values match the release record.
- [ ] Production Privy policy export or screenshot proves the correct chain, executor, function, and absence of broader wallet authority.
- [ ] Signer removal has been rehearsed and independently verified.
- [ ] Token approval revocation has been rehearsed and independently verified.
- [ ] Evaluator heartbeat becomes unhealthy within the documented stale window when the worker stops.
- [ ] New arming is rejected while the evaluator is unhealthy.
- [ ] Unknown or timed-out submissions enter `review_required` and are never automatically retried.
- [ ] Production logging excludes bearer tokens, authorization keys, private wallet data, and full sensitive order records.
- [ ] Monitoring alerts exist for heartbeat failure, evaluator errors, review-required orders, failed transactions, and stale submitted orders.
- [ ] User-facing copy shows asset access, trigger authority, route, recipient, expiry, transaction status, and revocation.

## Bounded canary

The first enabled order must use a dedicated RMT-owned test wallet and an amount whose complete loss is acceptable.

Canary sequence:

1. Fund the wallet with network gas and a minimal eligible token position.
2. Record balances, allowance, signer state, policy ID, order record, and expected executor.
3. Arm a short-lived order with conservative price-impact limits.
4. Prove the evaluator observes and updates the high-water mark without submitting early.
5. Trigger under controlled market conditions or through the approved test procedure.
6. Confirm WETH arrives only at the protected wallet.
7. Confirm the executor retains no token, WETH, or router allowance.
8. Confirm the order is consumed and the transaction reconciles to `executed`.
9. Confirm the app exposes the transaction hash and completed state.
10. Revoke the token allowance and signer, then independently verify both are removed.
11. Repeat a cancellation-only canary in which no transaction is ever submitted.
12. Retain transaction, log, policy, order-state, and revocation evidence in the release record.

No public wallet may arm an automatic exit until the canary has been reviewed and signed off.

## Activation order

Production configuration must be enabled in this order:

1. Deploy and verify the executor.
2. Create and inspect the restricted Privy policy and signer.
3. Configure server-only authorization and evaluator secrets.
4. Start the evaluator and verify a fresh heartbeat.
5. Run the bounded canary.
6. Enable server worker configuration for the approved environment.
7. Enable the public Position Guard flag and exact executor, policy, and signer identifiers.
8. Verify the public UI still fails closed when any required value is absent or mismatched.

Never enable the public flag before the server, policy, executor, and evaluator are independently healthy.

## Emergency response

Automatic execution must be disabled immediately when any of the following occurs:

- unexpected executor call or recipient behavior;
- signer or authorization-key exposure;
- policy scope mismatch;
- evaluator heartbeat instability;
- unexplained early execution;
- repeated `review_required` transitions;
- incorrect quote, price-impact, fee, or deadline behavior;
- router, factory, WETH, RPC, or chain incident;
- inability to remove signer authority or clear allowance reliably.

Response order:

1. Disable worker and public feature flags.
2. Stop evaluator submission while preserving receipt reconciliation.
3. Notify affected users to revoke executor allowances and app signers.
4. Identify all active, executing, submitted, and review-required orders.
5. Reconcile every known transaction hash before any retry or reactivation.
6. Publish a factual incident record and corrective release gate.

Because the executor is ownerless, it cannot be paused onchain. Operational shutdown depends on disabling the signer/evaluator and users revoking approvals. That limitation is part of the release decision, not an implementation detail to omit.

## Evidence record template

Each release record should contain:

- source commit and PR;
- contract source and runtime hashes;
- deterministic address calculation;
- deployment transaction and receipt;
- Blockscout verification link;
- immutable dependency reads;
- external review and static-analysis reports;
- mainnet-fork command and output;
- Privy policy and signer evidence;
- evaluator heartbeat and failure rehearsal;
- canary order, transaction, balances, and revocation evidence;
- approver names, date, and explicit go/no-go decision.

Until that record is complete, the correct release state is **deployed candidate, automatic execution disabled**.
