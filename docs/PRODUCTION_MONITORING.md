# Production health monitoring

RMT exposes a read-only production health endpoint at `/api/health` and a public status page at `/status`.

The endpoint verifies:

- Robinhood Chain RPC connectivity and current block height
- the version registry's active factory
- deployed factory bytecode and launch count
- immutable market fee and graduation target
- graduation adapter binding to the active factory

A healthy response uses HTTP 200. Any failed check uses HTTP 503 and includes the degraded check and reason. Responses are never cached.

## External alert setup

Configure an uptime monitor to request:

```text
https://robinhood-meme-terminal.vercel.app/api/health
```

every 1–5 minutes and alert on:

- any non-200 response
- timeout after 15 seconds
- two consecutive failures to reduce false alarms

The endpoint contains no secrets and performs read-only contract calls. External alerts are an operations step; they are not configured by this repository.
