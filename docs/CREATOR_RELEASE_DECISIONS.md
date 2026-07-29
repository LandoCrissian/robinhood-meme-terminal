# RMT creator release-review decisions

## Purpose

The private RMT review inbox can attach one immutable preparation decision to a creator's immutable release snapshot. This provides reasoned feedback without converting preparation evidence into marketplace, contract, legal, or investment approval.

Outcomes are:

- `preparation_ready`: the submitted preparation evidence is internally complete;
- `changes_requested`: the creator should revise the asset and prepare a new snapshot;
- `declined`: RMT will not progress that snapshot.

Every outcome requires a review note and structured reason code. A `preparation_ready` decision must use the `preparation_complete` reason. Decisions remain `simulation_only` with contract execution `disabled`.

## Authority and immutability

The decision endpoint requires:

- the exact verified RMT administrator email;
- a current Firebase ID token checked for revocation;
- an existing, valid immutable release snapshot;
- a bounded structured outcome, reason, and note.

One top-level private record is stored at:

`creatorReleaseDecisions/{reviewId}`

The assigned creator and RMT administrator can read it. Browser clients cannot create, update, or delete it. Repeating the exact decision is idempotent; a different later decision for the same snapshot is rejected. Requested corrections require a new asset revision and new snapshot rather than rewriting history.

## Economic boundary

A release-review decision does not approve either revenue source:

1. V6 token-market fees remain the immutable 70% creator / 30% RMT treasury split.
2. Creator-marketplace fees remain attached to a non-executable simulation policy.

RMT's later use of its own 30% protocol share for platform growth, listings, project programs, holder incentives, token actions, or reserves requires a separate published treasury-allocation policy and delayed governance. See `docs/TOKEN_FEE_TREASURY_ALLOCATION_BOUNDARY.md`.
