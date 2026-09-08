# Fresh directory availability

Base: `706270f7dadc564116777c549e22c8599223ac07`.

## Reproduction

The production root reader, indexed reader, batch identity reader, cold curated
snapshot reader, route wrapper and client hook reproduced two initial 503s with
zero client rows, followed by a healthy 100-row recovery. Curated snapshots use
process-local last-good memory and share ordinary live identity/RPC dependencies
with the indexed path. They are not independent cold-start availability.

An actual browser at the base showed `RWA 0` and `All 0` during first-request
unavailability. The correction shows unknown counts until an observation exists.
Valid observed zero counts remain zero. Loaded observations remain numeric.

## Durable browse evidence

The existing market indexer already persists independently verified ERC20
name/symbol/decimals in PostgreSQL compressed identity shards. Its authenticated
`/v1/pools?includeBrowseIdentities=true` now optionally returns metadata limited
to the exact returned pool tokens, explicitly labelled last-known. The normal
inventory response remains unchanged unless requested. Missing/corrupt shards
do not manufacture identities. Web parsing retains the existing chain, source
coverage, pool and pagination checks and rejects duplicate or unrelated identity
records, invalid decimals, malformed text and unknown provenance.

The browse reader uses this evidence before attempting live reads for missing
identities. Stock classification and project-identity admission remain required
under their existing policies. Last-known evidence is labelled stale; it does
not grant execution authority. Quote, authorization, runtime verification,
wallet binding and settlement functions are unchanged.

This is an additive change to the existing indexer, not another service or
database. The indexer change needs an owner-authorized service release before
the live web runtime can consume its durable metadata. Old indexers ignore the
opt-in query and continue to use live identity reads; the truthful unknown-count
UI works independently. No Production indexer/web deployment is part of this PR.

## Evidence

- Real server/hook cold failure and recovery: PASS; 100 rows recovered.
- Fresh indexer process objects reload the persisted shard without RPC: PASS.
- Cold web instances with durable metadata: 100 rows, stale, no live identity calls.
- Loaded-window, fallback, cursor, partial coverage, removal and quarantine: PASS.
- Optimized desktop/mobile 120-row intermittent sequence: PASS.
- Optimized healthy page load: desktop 244 ms; mobile 558 ms.
- External enrichment fixture delay: 45,000 ms.
- Web and market-indexer TypeScript checks: PASS.
- Optimized web build: PASS.
- Native trace, exact settlement, signer and frozen trading matrix checks: PASS.

Exact-head CI and Preview evidence are recorded in the PR discussion. Do not
interpret this local evidence as a Production release or a new live transaction.

## Advisory scope

Next.js is 15.5.22. GHSA-p293-qw3h-jr36 affects Windows-hosted servers; Vercel/Linux
does not satisfy that platform condition. Windows testing is loopback-only.
The audit also reports GHSA-2xp9-vwfh-vxw4 and GHSA-rgj7-g3m4-5g8c for AVIF/sharp;
those findings are not Windows-only and must not be hidden by that classification.
No dependency upgrade or audit suppression is included in this directory patch.
