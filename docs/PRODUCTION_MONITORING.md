# Production health monitoring

RMT exposes a read-only production health endpoint at `/api/health` and a public status page at `/status`.

The protocol endpoint verifies:

- Robinhood Chain RPC connectivity and current block height
- the V6 version registry's active factory and configured scan boundary
- deployed factory bytecode, V6 protocol version, public launch state, and launch count
- immutable curve fee, 70/30 split, and 2 ETH graduation target
- the latest V6 market and graduation adapter binding

A healthy response uses HTTP 200. Any failed check uses HTTP 503 and includes the degraded check and reason. The public endpoint uses a 15-second shared cache so visitor traffic does not multiply the same RPC-heavy verification work; each report includes its exact `checkedAt` timestamp.

## External alert setup

Configure an uptime monitor to request:

```text
https://www.rmtlaunch.fun/api/health
```

every 1–5 minutes and alert on:

- any non-200 response
- timeout after 15 seconds
- two consecutive failures to reduce false alarms

The endpoint contains no secrets and performs read-only contract calls. The repository also runs `.github/workflows/production-health.yml` every five minutes to check the canonical redirect, protocol state, confirmed launch feed, Railway indexer, and official-market trade proxy. An external uptime provider remains a recommended independent alert path.
