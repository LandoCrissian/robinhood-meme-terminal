# RMT NFT execution fee settlement V1 — research contract

**Status:** research-only / not runtime / not production-authorized  
**Chain:** Robinhood Chain (`4663`)  
**Economic intent:** 25 basis points on successful RMT-originated NFT buys and sells  
**No deployment, treasury activation, wallet authorization or fee collection is authorized by this document.**

## Why NFT fee settlement is separate

Current fungible fee work deducts the fee from fungible swap input. NFT marketplace settlement is different: signed orders bind asset, amount and recipient obligations, and the NFT itself can never be the fee asset.

NFT V1 therefore preserves one business rule while using NFT-specific settlement mechanics:

- 25 bps;
- floor rounding;
- no minimum;
- authenticated RMT execution only;
- zero fee on approvals/signatures/cancellations;
- zero fee on failed/reverted execution;
- successful execution requires independently verified atomic fee settlement.

## Canonical fee basis

`feeBasis = venueGrossPayment`

`rmtFee = floor(venueGrossPayment * 25 / 10_000)`

`venueGrossPayment` is the normalized sale/offer payment principal for the NFT fill in its payment asset. It is not gas and is not recomputed by summing every marketplace/royalty line. Provider-specific normalization must prove the value from the signed order/fulfillment.

This prevents double-charging when marketplace fees or royalties are already embedded in or deducted from the sale price.

### Buy

RMT fee payer: buyer.

`userTotalDebit = venueBuyerDebitBeforeRmt + rmtFee`

Exact venue consideration remains untouched. The RMT fee is a separate payment in the same outer transaction.

### Sell

RMT fee payer: seller.

`sellerNet = venueSellerProceedsBeforeRmt - rmtFee`

If seller proceeds are not greater than the fee, the route is not execution-admissible.

## No fee on non-execution actions

These settle exactly zero RMT execution fee:

- NFT approval;
- ERC-20 approval;
- listing/order signature;
- offer signature;
- cancellation;
- quote observation;
- simulation;
- failed transaction;
- reverted transaction;
- marketplace sale that cannot be proven RMT-originated.

A successful receipt without independently verified atomic fee settlement is an integrity failure, not revenue evidence.

## Seaport buy route

Research route: `listing-buy-via-rmt-executor`.

1. Verify the unchanged maker listing and canonical Seaport order hash.
2. Normalize exact venue consideration and optional-vs-required creator fee choice.
3. Compute 25 bps from `venueGrossPayment`.
4. Bind policy hash, treasury, buyer, NFT recipient, item/quantity, order hash, payment asset, gross amount, fee, provider calldata hash and deadline.
5. Wallet target is the pinned RMT NFT executor, never direct Seaport for a fee-admitted RMT execution.
6. Executor calls pinned Seaport 1.6 using a decoded/allowlisted `fulfillAdvancedOrder` path with the authenticated user as NFT recipient.
7. Exact venue consideration and separate RMT fee settle in the same outer transaction.
8. Any provider or fee transfer failure reverts the entire outer transaction.
9. Receipt reconciliation proves both NFT fill and exact RMT fee.

For native ETH, outer funding must match the committed requirement and no unexplained residual may remain.

For ERC-20, executor spend/allowance must be exact and must not leave reusable residual approval without separate admission.

`fulfillBasicOrder` is not fee-admitted by this research.

## Seaport sell route

Research route: `offer-sell-via-seller-counterorder`.

Do not implement seller-side fees by making a generic executor take temporary custody of the seller NFT.

Use the unchanged buyer/maker offer plus a seller-side counter-order:

1. buyer offer remains economically unchanged;
2. seller counter-order binds the exact NFT/criteria fill;
3. seller counter-order explicitly accounts for required venue/royalty recipients, seller net proceeds and exact RMT fee;
4. seller signs only after item, offer, recipients, fee, treasury, deadline and policy hash are bound;
5. pinned executor submits a decoded/allowlisted `matchAdvancedOrders` path;
6. every offered/considered unit must reconcile with no unexplained remainder;
7. provider match and RMT fee both settle or both revert;
8. receipt reconciliation proves NFT transfer, seller net and RMT fee.

## Mandatory wallet admission proof

Authorization requires exact/fresh evidence for:

- chain ID 4663;
- active NFT fee policy and nonzero policy hash;
- exact treasury;
- exact 25-bps floor math;
- payment asset;
- NFT identity/quantity;
- maker order hash;
- venue/protocol identity;
- pinned RMT NFT executor wallet target;
- pinned Seaport provider target;
- side-specific allowlisted selector;
- provider calldata hash;
- every venue consideration recipient/amount;
- creator fee optional/required choice;
- buyer total or seller net;
- NFT recipient;
- live status/counter/ownership/balance/approvals;
- fresh full outer-transaction simulation;
- atomic provider+fee revert semantics.

Unknown authorization-affecting values fail closed, while read-only market visibility may remain permissive and truthful.

## Attribution and revenue accounting

Revenue evidence binds:

- `executionOrigin = authenticated_rmt`;
- project/collection identity independently;
- venue independently;
- order hash;
- execution ID;
- transaction hash;
- payment asset;
- venue gross payment;
- expected and actual RMT fee;
- treasury receipt/log evidence;
- policy ID/version/hash;
- receipt status and rollup block.

Marketplace-observed sales never become RMT revenue by indexing alone.

## Venue boundary

- OpenSea / Seaport 1.6: first design target; execution remains blocked until executor/runtime/adversarial/live proof.
- StonkBrokers / Anvil: candidate-only and a separate settlement family.
- Mintera / HoodMarket: candidate-only until secondary settlement authority is pinned.
- Nightgarden: catalogue-only while marketplace settlement is not independently live/verified.
- Reservoir hosted API: not assumed to support Robinhood Chain.

No venue inherits admission from another venue.

## Production gates

Before any NFT fee becomes active:

1. explicit architecture admission;
2. reconcile the final VNext fungible fee architecture after PR #428 or successor;
3. define exact production policy tuple and keccak policy hash using the canonical RMT hashing pattern;
4. audited/pinned executor implementation and runtime bytecode;
5. exact treasury approval;
6. provider deployment/runtime/conduit evidence;
7. controlled Robinhood Chain buy and sell proofs;
8. adversarial tests for fee bypass, recipient replacement, calldata substitution, reentrancy, residual approvals, malicious token behavior, receiver behavior, stale orders and partial fills;
9. wallet review/pre-sign evidence shows exact fee and net economics;
10. reconciliation independently proves settled revenue;
11. explicit owner release boundary.

Until all gates pass, NFT fee state remains **research-only / not admitted**.

## Primary protocol references checked 2026-08-23

- `https://docs.opensea.io/docs/seaport`
- `https://github.com/ProjectOpenSea/seaport/blob/main/docs/SeaportDocumentation.md`
- `https://docs.opensea.io/reference/generate_listing_fulfillment_data_v2`
- `https://docs.opensea.io/reference/generate_offer_fulfillment_data_v2`
