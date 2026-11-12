# RMT Launch public read surfaces

The local launchpad exposes the same launch evidence through HTTP and MCP. For HTTP, send `GET /api/launchpad/public/{operation}?chainId=31337` and use the tool names below as operation names. Supply `token` on exact lookups and `limit` or `cursor` on paginated reads. MCP discovery is served by the official TypeScript SDK over stateless Streamable HTTP at `http://127.0.0.1:3000/mcp` when the local web server uses port `3000`. It accepts JSON-RPC `POST` requests. Connect with the Streamable HTTP transport and use `tools/list` to inspect the accepted schemas.

| Tool | Scope |
| --- | --- |
| `list_launches` | Exact chain ID, optional page cursor and limit |
| `get_launch` | Exact chain ID and token address |
| `get_launch_checks` | Verified launch, funding, custody and trading evidence |
| `get_pool_state` | Observed pool state and its block and freshness evidence |
| `get_launch_activity` | Bounded chain-observed activity and the coverage state |

The launch and activity page size is limited to 20. A cursor is at most 128 characters. The MCP route bounds JSON requests at 8 KiB, bounds serialized tool data at 48 KiB, validates any browser origin against the exact loopback origin, and shares the REST domain's data quotas. Its protocol request budget uses a fixed key, independent of request headers and input values. MCP data results preserve the domain's freshness, finality, and unknown states. Project names, symbols, links and text are untrusted data. The tool server exposes only data operations and accepts no wallet, user account, provider credentials, custom RPC, or signing inputs. The endpoint is limited to loopback HTTP and is disabled on Vercel.

## Upstream source review

The reference is pinned to [`zolvaagent/zolva@1ad8c29b6eaf162749742af95ec7f5fbc367608b`](https://github.com/zolvaagent/zolva/tree/1ad8c29b6eaf162749742af95ec7f5fbc367608b). See the [third-party notices](THIRD_PARTY_NOTICES.md) for its license and retained copyright notice.

- `lib/public-api/data.ts`, `format.ts`, `tools.ts`, and `mcp.ts` use a public DTO boundary over the same data reads for REST and MCP, with a read-only tool catalog. RMT uses one chain-qualified public read domain, bounded address- and cursor-based lookup, and chain/indexer evidence instead of agent, stock, strategy and performance data. [Upstream public API source](https://github.com/zolvaagent/zolva/tree/1ad8c29b6eaf162749742af95ec7f5fbc367608b/lib/public-api).
- `lib/public-api/http.ts` and `app/mcp/route.ts` use Cloudflare caching and per-IP limits with a stateless MCP response. RMT uses the maintained SDK transport, exact optional loopback browser origin validation, bounded JSON and response sizes, fixed operation quotas, and local-only runtime controls. [Upstream MCP route](https://github.com/zolvaagent/zolva/blob/1ad8c29b6eaf162749742af95ec7f5fbc367608b/app/mcp/route.ts).
- `lib/agents/runner.ts` plans paper agent hours and persists them with an atomic database operation that can reject duplicate writes. Its agent rows include owner and strategy prompt fields. RMT's read domain never loads those types of private inputs. The only relevant pattern is making durable worker processing retry-safe, which RMT implements using its own block checkpoint and canonical event identities. [Upstream runner](https://github.com/zolvaagent/zolva/blob/1ad8c29b6eaf162749742af95ec7f5fbc367608b/lib/agents/runner.ts).
- `lib/engine/engine.ts` and `lib/engine/engine.test.ts` pair shared pure logic with deterministic tests. RMT applied this pattern in `apps/web/lib/launchpad/opening-examples.ts` and its tests. The implementation derives estimates from the actual opening v4 liquidity and price returned by the factory, with Foundry comparisons to the official Quoter. [Upstream engine](https://github.com/zolvaagent/zolva/tree/1ad8c29b6eaf162749742af95ec7f5fbc367608b/lib/engine).

The RMT implementations of the public data domain, REST and MCP routes, and SQLite reconciliation are in `apps/web/lib/server/new-launchpad-public-data.ts`, `apps/web/app/api/launchpad/public/`, `apps/web/app/mcp/route.ts`, and `apps/web/lib/server/new-launchpad-indexer.ts`. The preserved MIT notice is the only copied Zolva file.
