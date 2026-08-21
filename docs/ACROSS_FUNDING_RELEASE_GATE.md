# RMT Across funding release gate

Status: **implemented behind disabled server gates; not production-ready**.

This milestone is funding only:

`native Circle USDC (Ethereum, Arbitrum, or Base) -> canonical USDG (Robinhood Chain 4663) -> the same user wallet`

It does not compose a destination trade, submit a transaction from the server, expose external USDC in the public selector, charge an RMT fee, or claim atomic settlement.

## Trust boundary

- Asset identity is `(chainId, contractAddress)`, never symbol.
- The depositor, destination recipient, and origin refund recipient must be the same Privy-linked user wallet.
- The output must be canonical Robinhood USDG.
- The Across route must be direct `bridgeableToBridgeable`, with no origin swap, destination swap, embedded action, or destination message.
- The source and destination SpokePools must match the approved proxy runtime, EIP-1967 implementation address, and implementation runtime hash. Proxy bytecode alone is insufficient for these upgradeable contracts.
- Provider calldata is decoded and canonically re-encoded before it may be shown to the wallet.
- A provider-supplied broad token approval is replaced with an exact input-amount approval.
- A submitted source transaction is accepted only after its hash, sender, source SpokePool, zero native value, and calldata hash match the persisted verified quote.
- `deposit_confirmed` requires a successful source receipt with exactly one current `FundsDeposited` event whose deposit economics, wallet bindings, destination chain, deadlines, relayer, and message match the persisted quote. Across API status cannot establish the deposit ID.
- If Across returns both legacy and current transaction-hash fields, every populated alias must agree exactly.
- The server never submits the deposit.

Deployment values are not admitted by shape alone. `ACROSS_FUNDING_DEPLOYMENT_V1` binds each supported chain to the reviewed SpokePool proxy/runtime, EIP-1967 implementation/runtime, and pinned block/hash evidence. Environment pins must match that manifest exactly. Quote preparation also performs a fresh hash-rechecked runtime observation.

Wallet readiness is two-stage. The inexpensive pre-quote gate proves source-token balance and nonzero native balance. After strict Swap API verification, RMT estimates the exact replacement approval (when required) and exact returned deposit transaction against one source-chain block, applies a documented 25% fee-cap margin, and fails closed if estimation is unavailable, stale, or definitely underfunded. This is an upper-bound readiness estimate, not a guaranteed wallet gas price.

RMT supplies the integrator ID only as the Swap API query parameter and sends returned `swapTx` calldata unchanged. The decoder tolerates only canonical calldata and the narrow, known suffix/marker forms returned by Across; unknown trailing bytes are rejected. Legacy `/available-routes` data is never release authority.

## Lifecycle and availability

The persisted lifecycle is:

`quote_ready -> source_submission_pending -> source_submitted -> deposit_confirmed -> bridging/fill_pending -> destination_confirmed -> completed`

Recovery states are:

`expired -> refund_eligible/refund_pending -> refunded`, plus `failed` and `recovery_required`.

Pending output is never included in available USDG. A provider `filled` status produces `destination_confirmed` only. `completed` requires a successful Robinhood receipt for the exact Across-reported fill transaction and a canonical USDG `Transfer` to the verified user wallet for at least the protected output. A source receipt may be persisted before Across indexes the deposit, so provider indexing lag does not erase proven progress.

Sessions are written both to a bounded local recovery journal and to a wallet-scoped server collection. The server rejects ownership mismatches, immutable-intent rewrites, anchored-evidence changes, lifecycle-history rewrites, conflicting same-version writes, source-transaction replacement, and out-of-order state transitions.

Authenticated session reads and lifecycle refreshes also return a sanitized proof record derived from the verified session. It captures chain-qualified assets, pinned SpokePool deployments, quoted and realized economics, source/deposit/destination/refund identifiers, lifecycle timestamps, pending versus available output, and whether the terminal outcome was delivery or refund. It contains hashes rather than raw transaction calldata and records that RMT never submitted user funds.

## Refund semantics

Across V3 intents do not allow partial fills. If no relayer fills before the verified `fillDeadline`, the deposit becomes refund-eligible. The source funds remain escrowed while Across bundle settlement and its challenge/canonical-bridge process complete; this can take hours.

RMT requests `refundOnOrigin=true` with the connected user wallet as `refundAddress`. The expected refund is the source-chain native USDC asset back to that wallet. RMT does not mark a refund complete from API status alone: it requires the exact Across-reported refund transaction to succeed and contain a source-USDC `Transfer` to the verified refund recipient.

The current relayer-refund root event does not carry the original deposit ID. RMT therefore still relies on Across tracking to identify the candidate refund transaction, then independently proves that transaction and token delivery onchain. A controlled expiry/refund rehearsal must validate this linkage before production enablement; it remains an explicit unresolved release assumption.

Tracking remains available when new Across quotes or authorizations are killed. A provider/API/RPC outage must leave the last persisted state intact for later reconciliation.

Primary protocol references:

- https://docs.across.to/introduction/tracking-deposits
- https://docs.across.to/introduction/refunds
- https://docs.across.to/guides/concepts/intent-lifecycle
- https://docs.across.to/guides/migration/v2-to-v3
- https://github.com/across-protocol/contracts

## Production enablement blockers

The readiness endpoint reports API credentials, contract pins, dedicated authenticated RPCs, and Firebase Admin persistence separately. `configured` becomes true only when all four groups are valid. Quote and authorization flags cannot override a missing dependency, while disabling new quotes does not disable correctly configured tracking for deposits already in flight.

All of the following must be complete before external USDC becomes visible:

1. Production Across API key and registered two-byte integrator ID are configured server-side.
2. Ethereum, Arbitrum, and Base source SpokePool runtime bytecode is independently reviewed and exact runtime hashes are configured.
3. Dedicated source-chain and Robinhood RPCs use server-only bearer authentication, have monitoring, and have acceptable failure behavior. Credentials must not be embedded in endpoint URLs.
4. Firestore persistence is configured and cross-device recovery is rehearsed with the same Privy-linked wallet.
5. Controlled mainnet proofs complete in order: Base, Arbitrum, then Ethereum native USDC to Robinhood USDG.
6. Each proof records the source transaction, deposit ID, quote and realized economics, lifecycle events, destination transaction, recipient, token, balance delta, and timing.
7. Expiry/refund behavior is proven against live/API/onchain evidence or a protocol-supported controlled rehearsal; written assumptions are not sufficient.
8. Adversarial checks remain green and production monitoring/alert thresholds exist.
9. Operators separately enable quote and authorization gates. Public asset selection requires a later reviewed code change; it is hard-disabled in this milestone.

Do not begin Relay direct bridge-and-buy until this milestone is proven and reported.
