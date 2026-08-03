# Treasury accounting and allocation

## Purpose

RMT must be able to explain where protocol-owned funds came from before proposing where they go. A wallet balance alone is not an accounting system: it can combine different assets, revenue sources, time periods, refundable funds, and unrelated transfers.

The first treasury-accounting increment is evidence-only and non-executable. It does not read a signer, build transaction calldata, submit governance proposals, move funds, advertise a reward, or activate a token flywheel.

## Source separation

Every ledger entry records:

- one revenue classification;
- one exact asset identity, chain, symbol, and decimal precision;
- one positive atomic-unit amount;
- one onchain event anchor or offchain evidence digest;
- one receipt time and plain-language disclosure;
- the applicable source-policy hash where required;
- deterministic evidence and entry fingerprints.

V6 curve protocol fees, marketplace fees, listings or advertising, subscriptions, referrals, sponsorships, grants, and other disclosed revenue remain separate. The same evidence key cannot be recorded twice under different labels.

V6 token-fee entries require a source-policy hash and represent only the RMT-owned protocol receipt. The creator's 70% is not a treasury source and is never accepted as an allocation input.

Revenue is also locked into one of four accounting domains:

- `v6_token_market` for confirmed V6 curve protocol receipts only;
- `creator_marketplace` for a future separately approved marketplace fee;
- `commercial_services` for paid listings, advertising, subscriptions, and referrals;
- `ecosystem_funding` for sponsorships, grants, and other disclosed funding.

One allocation draft cannot combine domains. V6 therefore remains independently reportable even when another RMT product receives the same asset. A future proposal to use multiple domains for one program must present separate source allocations and governance evidence rather than hiding them in one pooled number.

V4 and post-graduation fees are excluded from this accounting model and the V7 flywheel roadmap. Existing immutable V6 contract capability remains part of the historical protocol record, but it is not an eligible revenue source or future dependency here.

## Allocation drafts

An allocation draft:

1. binds to a versioned treasury-allocation policy;
2. reserves explicit atomic amounts from explicit ledger entries;
3. rejects unknown, duplicated, cross-asset, or over-reserved sources;
4. calculates category amounts deterministically without losing rounding dust;
5. carries no transaction payload and leaves contract execution disabled.

The current categories are platform growth, project support, holder incentives, governed token actions, and safety reserves. These category names do not approve percentages, recipients, campaigns, buybacks, burns, purchases, grants, or holder payments.

## State boundary

The intended lifecycle is:

1. evidence observed;
2. source classified and reconciled;
3. non-executable allocation draft prepared;
4. public policy and eligibility reviewed;
5. delayed governance proposal prepared separately;
6. exact onchain execution independently verified;
7. public post-execution report reconciled to the original source entries.

Only stages 1–3 have an application model today. Later stages require explicit implementation, legal and accounting review, production monitoring, and separate deployment authorization.

## Holder and project programs

“Back to holders” is not interest, yield, ownership of treasury balances, or a guaranteed return. Any holder program requires published eligibility, budget, duration, anti-manipulation rules, jurisdictional review, and a clear statement that participation does not create a claim on future protocol revenue.

Project support likewise requires published criteria, conflict disclosures, recipient verification, milestone evidence, and outcome reporting. Paid promotion or listings must be visibly labeled and cannot alter organic rankings or risk classifications.

## Next production blockers

- Reconstruct confirmed V6 curve splitter distributions into source-specific receipt records. Stored event capability is not evidence that a fee has occurred.
- Count only the protocol leg of each 70/30 distribution. If delayed governance redirects the creator's future 70% to the treasury address, the creator and protocol legs can share one recipient; address matching alone would overstate protocol revenue.
- Treat `PaymentDeferred` and `TokenPaymentDeferred` as receipt ownership outcomes, while later deferred claims are settlement events—not new revenue.
- Accept only native curve receipts from the bound V6 market payer. Adapter and launched-token fee events are outside this V7 treasury-accounting path.
- Reconcile indexed receipts against actual treasury asset balances.
- Define how unsolicited transfers, refunds, unsupported assets, and pricing are reported.
- Approve exact allocation percentages and program rules.
- Design proposal and execution receipts around the existing delayed V6 governance.
- Publish a read-only proof page before enabling any treasury action.
- Obtain specialist legal, tax, and accounting review.
