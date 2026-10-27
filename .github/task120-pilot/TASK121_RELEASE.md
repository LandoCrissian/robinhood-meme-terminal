# Task121 shared 0x quota release contract

This remains a non-production pilot. No production setting is enabled by this
change. CannaCat, chain 4663, native ETH, 25 bps, canonical authentication,
verification, authorization and settlement are unchanged.

## Admission authority

`apps/web/lib/server/zero-x-shared-quota.ts` guards every outbound `api.0x.org` request from this
Netlify function, including calls without a telemetry context. All API keys and
endpoints use the same fixed application keyspace. Lua uses Redis server time;
there is no process-memory or per-IP admission fallback.

The policy is three physical attempts per conservative 1,100 ms rolling window,
at most two price attempts, and one provider request in flight. Firm review can
use the reserved third slot. An admission reserves capacity until completion;
lost responses keep capacity reserved through a 6.5-second lease plus the window.
Provider requests have a four-second deadline. Upstream HTTP 429 publishes a
shared Retry-After cooldown. Only admission is retried (at most three attempts);
provider requests and transactions are never automatically retried here.

Identical GET price requests can coalesce within an instance. This is bounded
and is not the distributed authority. Executable quotes are never cached or
coalesced for signing. Passive market observation continues using pool RPC and
does not consume 0x quota. Quota errors preserve the existing client's amount
and retry handling.

## Required infrastructure and scope

Server-only, secret, Functions-scoped settings:

* `RMT_ZEROX_QUOTA_REDIS_URL`
* `RMT_ZEROX_QUOTA_REDIS_TOKEN`
* the existing `RMT_ZEROX_API_KEY` and commitment secret

The proof uses a free, unclaimed Upstash Redis database that expires after
72 hours. It stores only request IDs, timestamps, leases and cooldowns. It
contains no wallet records, signatures, quote bodies or provider credentials.
Claim/retain a coordinator before a production decision. Do not enter a card,
upgrade or enable paid overages without explicit owner authorization.

Every OTHER consumer of the RMT VNext Benchmark application's 5 RPS allowance
must adopt this same coordinator or be explicitly quiesced before an app-wide
production guarantee is possible. In particular, this change does not modify
preserved Vercel production services. A different key in the same 0x application
does not provide an independent quota. Headroom does not substitute for this
rollout requirement. The prepared `apps/web/instrumentation.ts` installs this
same guard once before an RMT Next server accepts requests. It fails closed
without coordinator settings. This must be deployed to preserved RMT servers
under separate owner authorization, or those consumers must be quiesced. Do
not run manual 0x benchmarks with this application key outside the same guard.

## Production gate (not enabled)

The default artifact refuses published deployments. A separately approved
production pilot requires all of:

* platform context positively identifies a published deploy;
* server setting `RMT_CANNACAT_PRODUCTION_PILOT_ENABLED=true`;
* exact `RMT_CANNACAT_EMBED_ORIGINS=https://lammb.fun`;
* retained shared Redis credentials and the unchanged execution release gates.

Request headers cannot activate this gate. Missing context or coordination
fails closed. An explicitly configured production preflight still does not
authorize a wallet: canonical identity and wallet checks remain mandatory.

Before enabling, confirm Privy production mode (the current app is testing-only
development mode), owner-approved billing exposure, Netlify credit balance and
auto-recharge safeguards, all-consumer quota coverage, exact-head checks and
the reviewed artifact hashes. Keep Genesis registration/admin/mint disabled.

## Acceptance and rollback

The API workflow runs real Redis Lua against independent worker processes,
contention, priority, deduplication, shared 429 cooldown, timeout recovery and
coordinator failure. Hosted proof must additionally correlate authenticated
requests with sanitized function logs. Synthetic provider failure tests are
not real trades or proof of funded settlement.

Stage only fresh, verified, unpublished deployments. Preserve the current
production publishing lock. After separate production authorization, deploy
the exact verified function and static artifacts with explicit production
settings. Do not merge or run database migrations. Roll back by redeploying
hash-verified known-good bytes through the supported fresh-deploy workflow;
never restore an ungated trading backend as an emergency fallback. If the
coordinator fails, keep trading closed while preserving history and wallet
controls. Revert the frontend to the known-good informational build if needed.
