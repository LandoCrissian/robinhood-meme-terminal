# CCFF00 Community Engine identity and Sybil boundary V1

**Status:** PLANNING ONLY — V1 RESIDUAL-RISK / FUTURE MITIGATION ANALYSIS  
**Locked V1 seat rule remains unchanged:** one current owner address holding at least one admitted public CCFF00 = one seat.

This document explains what that rule can and cannot prove and prevents future Codex work from quietly adding inaccurate “same human” heuristics.

## 1. V1 identity claim

V1 can objectively prove:

```text
At snapshot block B,
address A owns these admitted public CCFF00 token IDs.
```

It cannot objectively prove:

```text
A and B are the same human.
```

or:

```text
one smart-contract address represents exactly one human.
```

Therefore V1 is **address-fair**, not one-human-one-seat.

## 2. Known Sybil strategy

A holder with 10 Squares could move them from one wallet into 10 separate addresses.

At a later census, V1 sees:

```text
10 current owner addresses
→ 10 seats
```

There is no reliable chain-only fact proving those addresses share one human controller.

This is a residual V1 risk, not a bug in `ownerOf`.

## 3. Why not use funding-graph heuristics

Potential heuristic:

```text
all 10 wallets funded by same wallet
→ same person
```

Problems:

- exchanges/bridges/faucets fund unrelated people;
- families/teams/DAOs use common treasury;
- account-abstraction relayers sponsor many unrelated users;
- a Sybil attacker can vary funding paths;
- false positives would exclude legitimate holders.

Funding graph may be analytics/fraud signal, never entitlement authority in V1.

## 4. Why not use IP/device identity

Problems:

- VPN/NAT/shared household;
- privacy impact;
- mobile carrier addressing;
- multi-device users;
- not onchain/reproducible;
- creates centralized identity surveillance for an otherwise public-chain community utility.

V1 explicitly does not collect/use IP/device fingerprints to merge seats.

## 5. Why original mint clustering is not entitlement identity

Original mint recipient tells us:

```text
wallet A initially received token IDs X,Y,Z
```

It does not prove those Squares still belong to one human after transfers.

If A sells X to a legitimate new buyer B, continuing to treat X as part of A's seat would punish B.

Original mint clustering remains useful for:

- historical analytics;
- understanding initial multi-mint distribution;
- observing possible future gaming patterns;

but not current entitlement.

## 6. Why economic sale detection is not enough

One could try to distinguish sale vs self-transfer using marketplace consideration.

Problems:

- OTC sales;
- gifts;
- private transfers;
- bundled transactions;
- aggregator/escrow semantics;
- self-sale/wash paths;
- marketplace protocols change.

A transfer with no visible consideration is not proof of Sybil behavior.

## 7. Contract owner addresses

`ownerOf(CCFF00)` may be a contract rather than an EOA.

Examples:

```text
Safe / multisig
smart account
DAO vault
NFT vault/escrow
another token-bound account
custody contract
```

V1 still treats the exact current owner address as one seat.

Do not automatically exclude contract owners or explode them into underlying signer humans.

## 8. Safe/multisig ownership

A Safe may legitimately represent:

- one person using multisig security;
- a team;
- a DAO/community.

RMT cannot infer beneficial-person count from contract bytecode.

Seat remains the Safe address in V1.

## 9. TBA/nested ownership

A CCFF00 could potentially be owned by another contract/TBA under permitted token rules.

Then current seat address may itself be a token-bound account.

Do not recursively convert nested ownership into a human identity.

Use exact `ownerOf` address as V1 seat and separately verify delivery/TBA mechanics.

## 10. Contract-owner control of CCFF00 TBA

The CCFF00 token-bound account's controller semantics ultimately depend on current CCFF00 owner.

If owner is an EOA, direct owner-controlled execution is straightforward under the proven account implementation.

If owner is a contract, actual human/operator accessibility depends on whether that contract can execute the necessary call into the CCFF00 TBA.

V1 fairness does not automatically exclude the seat because this control path is unknown.

Possible delivery states:

```text
OWNER_CONTROL_KNOWN
OWNER_CONTROL_UNKNOWN_CONTRACT
```

The NFT can still belong to the Square/TBA even if current contract owner has inconvenient control; future Square transfer may move control. Whether production should block delivery to an unproven contract-owner control path is a Package F/H policy decision requiring real examples, not an assumption.

## 11. Sybil attack timing

Risk differs by timing.

### Split after mint opportunity appears but before acquisition census

Could multiply seats for that run if transfers finalize before acquisition anchor.

### Split after acquisition block

Does not alter the already committed seat census for that run.

### Split between runs

Can increase seat count on future runs.

The acquisition-block anchor prevents post-acquisition manipulation but does not solve pre-acquisition address splitting.

## 12. Existing V1 friction against opportunistic splitting

Even without identity heuristics:

- holder must actually move Squares onchain;
- transfers after acquisition do not alter that batch's seat selection;
- service history is address-based and new addresses enter at current community floor rather than historical zero;
- one mint run is floor-bounded;
- public proof makes large sudden seat-count shifts observable.

This reduces some timing games but is not full Sybil resistance.

## 13. Monitoring without punishment

Future observer can report non-entitlement analytics such as:

```text
unique current owner count trend
number of new owner addresses since prior census
number of multi-Square owners splitting between snapshots
concentration by owner
original-mint vs current-owner distribution
contract-owner count
```

These metrics can surface abuse patterns without automatically excluding anyone.

## 14. Future mitigation option M1 — fixed fairness epochs

Concept:

```text
epoch start snapshot
→ fixed seat cohort for one full service round
→ new owners join next epoch
```

Benefits:

- prevents splitting mid-epoch from immediately creating extra seats;
- simplifies fairness state/proofs.

Costs:

- legitimate new buyers wait until next epoch;
- sold-out holders may remain represented or need careful deactivation/transfer semantics;
- epoch could take a long time if few mints are acquired.

This is not V1 today.

## 15. Future mitigation option M2 — minimum holding/admission age

Concept:

```text
new current owner address becomes active seat only after holding >= X blocks/time
```

Benefits:

- reduces last-minute splitting.

Costs:

- penalizes legitimate new buyers;
- attacker can pre-age Sybil wallets;
- requires exact transfer-history tracking;
- adds more arbitrary economics/fairness policy.

Not recommended without evidence of actual abuse.

## 16. Future mitigation option M3 — optional signed wallet linking

A user explicitly signs from wallet A and B that they belong to one Community Identity.

Benefits:

- cryptographic and privacy-respecting;
- no heuristic false positives.

Problem:

- if fewer seats is economically disadvantageous, Sybil attacker has no incentive to self-link.

Useful for UX/account management, but not sufficient anti-Sybil defense by itself.

## 17. Future mitigation option M4 — proof-of-personhood/identity provider

Could provide closer to one-human-one-seat.

Costs:

- privacy/KYC/centralization;
- external dependency;
- excludes users unwilling/unable to verify;
- far beyond current CCFF00 community ethos/product need.

Not recommended for V1 without a major owner/product decision.

## 18. Future mitigation option M5 — Square-level entitlement

Revert to:

```text
one Square = one allocation unit
```

This is objectively Sybil-resistant with respect to wallet splitting because moving a Square does not create additional Square units.

But it favors whales by design, which the owner explicitly wanted to avoid.

Rejected for current V1 fairness.

## 19. Future mitigation option M6 — nonlinear Square weighting

Examples:

```text
1 seat + diminishing bonus for extra Squares
sqrt(squareCount)
log weighting
```

This compromises the locked owner decision that owning more Squares should not buy more odds.

Rejected unless owner explicitly changes economics.

## 20. Recommended V1 posture

Keep V1 simple and truthful:

```text
1 current owner address = 1 seat
```

with:

- no heuristics;
- no private identity tracking;
- acquisition-block snapshot anchor;
- current-floor fairness;
- public seat-count/concentration analytics;
- monitor for real address-splitting abuse before adding friction.

If abuse becomes material, evaluate fixed fairness epochs first because it reduces opportunistic mid-round gaming without pretending to know human identity.

## 21. Public wording

Say:

> One current CCFF00 owner address receives one Community Engine seat per admitted snapshot, regardless of how many Squares that address holds.

Do not say:

> One person gets one NFT chance.

because V1 cannot prove that claim.

## 22. Codex prohibition

Future Codex must not “improve” V1 Sybil handling by adding:

- common-funder address merging;
- IP/device merging;
- wallet-activity similarity;
- social-account matching;
- original-minter permanent grouping;
- contract-owner exclusion;

without a new explicit owner decision/policy version.

## 23. Test cases for identity boundary

Package A/E tests should include:

### Same address, many Squares

```text
A owns 10 → 1 seat
```

### Many addresses, one Square each

```text
A,B,C each own 1 → 3 seats
```

No attempt to infer controller relationship.

### Contract owner

```text
Safe S owns 4 → 1 seat S
```

### Original minter sold

```text
A initially received #1/#2
A later owns #1
B owns #2
→ current seats A and B
```

### Split observed between snapshots

Report seat-count change but do not auto-merge/exclude.

## 24. Owner decision trigger

Revisit Sybil policy only if public operational evidence shows address splitting materially degrades community fairness.

A future change must define:

- exact threat metric;
- exact mitigation;
- legitimate-buyer impact;
- migration of fairness state;
- public disclosure;
- adversarial tests.

Do not preemptively burden every holder to solve a hypothetical attack.
