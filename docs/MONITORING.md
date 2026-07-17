# Production Monitoring

## Automated checks

The `Production health` GitHub Actions workflow requests a run every five minutes and can be triggered manually. GitHub schedules are best-effort and may be delayed, so this workflow is a release and diagnostic check rather than the sole 1–5 minute alert channel. It retries transient failures, validates the machine-readable protocol health report, validates the cached launch feed, and preserves response evidence for seven days.

Canonical production origin: https://www.rmtlaunch.fun

The apex domain https://rmtlaunch.fun must permanently redirect to the canonical `www` origin.

Endpoints:

- `https://www.rmtlaunch.fun/api/health` — RPC chain ID, latest block freshness, registry bytecode and active factory, factory bytecode and launch count, immutable fee/target, adapter bytecode and factory binding
- `https://www.rmtlaunch.fun/api/launches` — cached confirmed-indexer launch data, source header, block checkpoint, and synchronization timestamp
- `https://www.rmtlaunch.fun/status` — user-facing version of the onchain health checks

## Alert ownership

GitHub Actions failure notifications are the temporary beta alert channel. Before broad launch:

- send alerts to at least two independent responders
- add an external uptime monitor from a provider independent of Vercel and GitHub
- monitor a second Robinhood Chain RPC
- establish a private security inbox
- test the signer contact tree

## Indexed monitoring layer

The persistent production indexer checkpoints blocks, waits for confirmation depth, detects reorgs, and replays idempotently. Monitoring should continue to alert on:

- active or pending factory version changes
- launch-event ingestion lag
- reserve/accounting invariant violations
- graduation attempts and failures
- adapter balances after settlement
- reward claim failures
- creator-payout and governance events
- unusual creator or wallet concentration
- frontend and API error-rate spikes

Follow [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) for severity and containment.
