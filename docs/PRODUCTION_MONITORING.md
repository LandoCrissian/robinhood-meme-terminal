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

The endpoint contains no secrets and performs read-only contract calls. The repository asks GitHub to run `.github/workflows/production-health.yml` every five minutes to check the canonical redirect, protocol state, confirmed launch feed, Railway indexer, and official-market trade proxy. GitHub scheduling is best-effort and may be delayed, so the external uptime provider is the required independent 1–5 minute alert path rather than an optional duplicate.

## Uniswap V3 fee-settlement monitoring

The public `RMT_EXECUTION_V1` release has a separate on-demand monitor. It is intentionally free and read-only: it does not use a Vercel function, cron, hosted scheduler, paid RPC, wallet, signing key or transaction.

Run from the repository root:

```text
pnpm monitor:uniswap-v3-fees
```

The command reads `https://www.rmtlaunch.fun/api/vnext/readiness` and Robinhood's public mainnet RPC. It verifies:

- chain ID `4663` and a 64-block confirmation boundary;
- the immutable public release block `37805030`, its block hash and timestamp;
- the exact executor address and live runtime hash;
- public policy, proof-binding, authorization and wallet-submission readiness;
- every confirmed `RMTUniswapV3FeeSettled` event since the release boundary;
- the successful receipt, unique execution ID, policy identity and 25-bps economics for each event;
- canonical USDG/WETH fee totals without treating the treasury's pre-release balance as public revenue;
- zero executor residual USDG/WETH balances; and
- zero executor-to-router USDG/WETH allowances.

The JSON field `healthy` is the operator decision. Exit code zero means every checked invariant passed. A healthy report may include `NO_CONFIRMED_PUBLIC_SETTLEMENTS_OBSERVED`; that means no confirmed public fee event exists in the scanned range, not that monitoring failed. Treasury balances are reported separately and are never used as the public settlement count.

Default endpoints can be replaced only for read-only diagnosis:

```text
RMT_FEE_MONITOR_RPC_URL=https://... \
RMT_FEE_MONITOR_PRODUCTION_ORIGIN=https://www.rmtlaunch.fun \
pnpm monitor:uniswap-v3-fees
```

Both overrides must be HTTPS. The command has no execution flag and allowlists only read RPC methods. Its parser/safety suite is:

```text
pnpm test:uniswap-v3-fee-monitor
```

### Operator response

Treat any nonzero exit, `healthy: false`, readiness mismatch, release-block hash mismatch, runtime mismatch, reverted or ambiguous receipt, duplicate execution ID, fee-economics mismatch, residual executor balance or nonzero router allowance as an incident:

1. preserve the JSON output and timestamp;
2. stop making release assertions;
3. verify the same evidence through an independent public RPC;
4. use the existing provider-specific public authorization kill switch to stop new fee-bearing Uniswap V3 authorizations only if the owner authorizes the production change; and
5. follow [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) without moving treasury funds or changing contracts from the monitor.

Run the command after a fee release, after any relevant deployment/configuration change, when reconciling a reported trade, and during manual operational review. Continuous paid monitoring is not required by this runbook; adding hosted scheduling is a separate cost and operations decision.
