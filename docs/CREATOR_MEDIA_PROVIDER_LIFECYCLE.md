# Creator media provider lifecycle

Status: preview foundation; provider deletion disabled
Last reviewed: 2026-07-29

## Purpose

RMT records creator metadata on public IPFS through its configured Pinata account only after an assigned creator explicitly requests pinning. A storage receipt proves what RMT asked its provider to retain at one moment. It does not grant RMT ownership of the work, guarantee permanent availability, or make the content erasable.

This lifecycle adds two distinct controls:

1. bounded availability observations for RMT's provider record and public gateway retrieval; and
2. an immutable request and decision path for removing RMT's provider copy.

Neither control mints, lists, transfers, pays, deploys, or operates a marketplace contract.

## State model

```text
verified immutable receipt
        |
        +---- daily bounded observation ----> healthy / degraded / unavailable
        |
        +---- creator request ----> private RMT review
                                      |
                                      +---- rejected
                                      |
                                      +---- approved for future execution
                                                   |
                                                   +---- provider deletion DISABLED
```

Receipts and observations are separate. Monitoring cannot rewrite a receipt. A creator request cannot delete a provider file. An approval acknowledges that the policy request is acceptable but still does not execute deletion.

## Takedown policy

An assigned, verified creator can create one immutable request for a receipt. The request records:

- the exact receipt, CID and Pinata file ID;
- a bounded reason and note;
- the requested action `unpin_rmt_provider_copy`;
- `contentErasureGuarantee: none`; and
- `providerExecution: disabled`.

The private RMT administrator can record one immutable decision:

- `approved_for_future_execution`; or
- `rejected`.

Every decision requires a review note. Changing a request or decision requires a new policy version; browser clients cannot edit or delete either record.

An approval does **not** mean that content is illegal, that a rights claim is proven, or that IPFS content will disappear. It means only that RMT may later consider removing the copy pinned under its own provider account after operational and legal review.

Pinata currently exposes deletion by public file ID through `DELETE /v3/files/public/{id}`. RMT deliberately does not call that endpoint in this rollout. See [Pinata: Delete File by ID](https://docs.pinata.cloud/api-reference/endpoint/delete-file-by-id) and [Pinata: Deleting Files](https://docs.pinata.cloud/files/deleting-files), checked 2026-07-29.

## Availability monitoring

The production schedule is prepared as one daily Vercel cron at `09:17 UTC`. It remains fail closed unless all of the following server-only settings exist:

- `CRON_SECRET` with at least 16 characters;
- `CREATOR_MEDIA_MONITOR_ENABLED=true`;
- valid Firebase Admin credentials;
- `PINATA_JWT`; and
- a valid HTTPS IPFS verification gateway.

Each run:

1. takes a short Firestore lease to prevent overlapping work;
2. reads at most `CREATOR_MEDIA_MONITOR_MAX_RECEIPTS` receipts, clamped to 1–12 and defaulting to 8;
3. checks the exact Pinata provider file ID, CID and stored byte count;
4. retrieves the metadata and verifies its exact byte length and hash;
5. reads at most 4 KiB from each referenced media object;
6. writes one immutable observation and one private latest-status record; and
7. releases the lease.

The current small-rollout query is intentionally capped and does not yet paginate beyond the first 12 provider receipts. Pagination or dedicated monitoring infrastructure is required before the creator inventory exceeds that bound.

Vercel Hobby currently permits cron jobs once per day with hourly scheduling precision, and cron function usage counts against normal function limits. The once-daily bounded design stays within that free scheduling boundary but does not promise zero future cost if traffic or inventory grows. See [Vercel cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs), updated 2026-01-28 and checked 2026-07-29.

## Health semantics

- `healthy`: the Pinata record matches and every bounded gateway check passes.
- `degraded`: metadata remains retrievable but the provider lookup is unknown or a referenced-media sample fails.
- `unavailable`: the provider record is missing or exact metadata retrieval fails.

A single failure is evidence for investigation, not proof of permanent loss. RMT records consecutive failures, never automatically unpins, and never treats a gateway error as a rights decision.

## Privacy and access

- Assigned creators and the RMT administrator can read current status, requests and decisions for their project.
- Only the RMT administrator can read immutable raw observations.
- Browser clients cannot create, update or delete lifecycle records directly.
- Maintenance locks are server-only.
- No Firebase UID, email, provider JWT or gateway credential is exposed publicly.

## Required before real provider deletion

Provider execution must remain disabled until RMT has:

1. a written retention and appeals policy;
2. a documented emergency path for credible safety or rights claims;
3. a second-person or delayed confirmation control;
4. exact provider-response verification and an immutable execution receipt;
5. a backup/replication policy that distinguishes creator withdrawal from disaster recovery;
6. creator-facing notice of the limits of IPFS deletion;
7. monitoring pagination and alert delivery;
8. production secrets configured and rotated; and
9. an explicit production authorization for the irreversible provider call.
