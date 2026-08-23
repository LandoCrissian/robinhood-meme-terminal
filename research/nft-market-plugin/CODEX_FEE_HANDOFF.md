# Codex fee handoff — NFT payment-side settlement

Do not implement this against stale VNext fee code. This is an isolated research contract.

## Reconcile first

Before runtime code:

1. read current `AGENTS.md`, architecture freeze/system map/completion gate;
2. inspect final PR #428 / `RMT_EXECUTION_V2` or successor state;
3. preserve the owner-approved RMT rate unless architecture explicitly changes it;
4. do not make NFT execution inherit fungible provider settlement mechanically;
5. reverify Seaport deployment/runtime/conduit and OpenSea API behavior;
6. run this plugin's fee smoke tests.

## Required semantic result

- 25 bps;
- basis = normalized venue gross NFT payment;
- floor rounding;
- no minimum;
- buy fee = buyer-side surcharge in payment asset;
- sell fee = seller-side deduction from payment proceeds;
- exact venue order/consideration preserved;
- no fee on approvals, signatures or cancellations;
- failed/reverted execution = zero fee;
- successful execution requires independently proven atomic RMT fee settlement;
- no direct-wallet provider fallback for an execution claiming RMT fee admission.

## A — read-only economics

Port `src/execution-fee.ts` semantics into the then-current canonical VNext economics domain. Do not add wallet submission.

Acceptance:

- exact 25-bps floor vectors;
- buyer and seller net economics;
- marketplace/royalty fees preserved separately;
- fee never counted twice;
- unknown payment economics fail closed for fee planning.

## B — Seaport buy verifier

Implement the side-specific verifier before executor code.

Require pinned Seaport, exact order hash, exact consideration, exact NFT recipient, exact payment debit, exact RMT fee, policy hash, treasury, calldata hash and fresh simulation.

No direct Seaport wallet authorization may be labeled fee-admitted.

## C — Seaport seller counter-order verifier

Build and verify seller counter-orders for offer acceptance. Do not temporarily custody the seller NFT as a shortcut.

Require `matchAdvancedOrders` semantics to account for every unit and recipient, including seller net and RMT fee.

## D — executor contract

Only after verifier tests pass, implement the smallest provider-specific executor surface. Avoid generic arbitrary-call execution.

`contracts/IRmtNftFeeSettlementV1.sol` is a semantic boundary, not production code.

## E — authorization / wallet

Only after runtime bytecode is pinned and controlled proofs pass:

- wallet target exact executor;
- user sees gross payment, marketplace/royalty economics, RMT 0.25%, gas, total/net;
- pre-sign evidence binds policy hash + execution ID + order hash + calldata hash;
- approvals are narrow and not revenue-bearing.

## F — reconciliation / release

Receipt must independently prove NFT transfer and exact fee settlement. Attribute venue, project/collection and RMT execution independently.

No release until explicit owner approval and a production effective boundary exist.
