# Dependency security policy

RMT installs production dependencies from the committed `pnpm-lock.yaml` with pnpm `10.12.1`. Project-level dependency overrides and lifecycle-script allowlists live in `pnpm-workspace.yaml`, which is the configuration source supported by the pinned pnpm release and newer pnpm clients.

## Enforced controls

- `postcss` is overridden to `8.5.10` and `ws` to `8.21.0` across the workspace.
- Only `esbuild` and `sharp` may run dependency build scripts.
- Optional native builds from `@reown/appkit`, `bufferutil`, `keccak`, and `utf-8-validate` are intentionally ignored because RMT does not require them for its browser or server release paths.
- `@firebase/util` and `protobufjs` install scripts are also denied. The Firebase script only rewrites packaged defaults from an optional installation-time environment value, which RMT does not use, and the protobuf script only emits dependency-version guidance. Their shipped runtime files remain sufficient for RMT and the emulator tests.
- CI runs `pnpm audit --prod --audit-level high` before typechecking or building the web application.
- Release verification must use `pnpm install --frozen-lockfile`; dependency upgrades require a reviewed lockfile change.
- The web app pins the modular Firebase SDK to `12.16.0`. Firebase is loaded only when the complete public web configuration is present; Firestore access remains restricted by the committed per-user rules.
- Firebase rules are exercised against the local Firestore emulator with pinned `firebase-tools@15.24.0` and `@firebase/rules-unit-testing@5.0.1`. CI supplies Temurin Java 21 for the emulator; these tools are development-only and are not included in the production web bundle.

## Task 022 dependency review

The exact #589 lockfile reported nine moderate and two low production advisories. The Task 022 maintenance commit updates patched versions using pnpm 10.12.1 and retains the pinned Solidity, Uniswap and OpenZeppelin inputs. The production dependency audit on the regenerated lockfile returned zero known vulnerabilities.

| Dependency and patched version | Advisory disposition and RMT reachability |
| --- | --- |
| `hono` 4.13.16 | [Mount path](https://github.com/advisories/GHSA-4m76-xfj5-7975), [RegExpRouter middleware](https://github.com/advisories/GHSA-h7mg-cq63-vhpq), [CSS interpolation](https://github.com/advisories/GHSA-3gg2-335m-rxc6), [text/ping CSRF](https://github.com/advisories/GHSA-46wx-v44x-9hh2), [multipart validation](https://github.com/advisories/GHSA-4h7h-rv7c-7m2v). The public-read dependency graph includes the MCP SDK. The Next route uses the SDK Web Standard transport, its own origin boundary and bounded JSON parsing. It does not call the affected Hono routing, HTML or form helpers. |
| `@hono/node-server` 2.1.6 | [WebSocket reset](https://github.com/advisories/GHSA-qv5m-9pm6-hqp3), [backslash path](https://github.com/advisories/GHSA-jpvv-r467-5p4w). Present through the MCP SDK, within its declared 2.x range. Next serves the reviewed MCP route through Web Standard transport, without this adapter or its upgrade path. |
| `pino-pretty > fast-copy` 3.1.0 | [Deep-copy stack exhaustion](https://github.com/advisories/GHSA-jggr-w7fw-pc2j). Same major and upstream range. Reaches the shared Privy logger graph. The injected curve wallet and its transaction journal do not use the logger to establish account or settlement. |
| `firebase-admin > @fastify/busboy` 3.2.2 | [Multipart field injection](https://github.com/advisories/GHSA-gxm5-99cw-xjw9). Same major and upstream range. Firebase Admin is shared server infrastructure. The curve reads and wallet path do not use that multipart parser. |
| `@google-cloud/storage > fast-xml-parser` 5.12.0 | [Unterminated XML stop-node parsing](https://github.com/advisories/GHSA-474x-hrwr-fgx4). Same major and upstream range. The path is through Firebase Admin's Cloud Storage dependency. The curve index, wallet and read endpoints do not parse external XML. |
| `nft-marketplace-indexer > tsx` 4.23.0 | [esbuild development server](https://github.com/advisories/GHSA-67mh-4wv8-2f99). Aligns the worker with the already resolved workspace `tsx` 4.23.0 and removes esbuild 0.23.1 from the lock. The affected development server does not serve the launchpad. The worker's exact runner pin and assertion move together. |

The web build, wallet/recovery regressions, MCP transport tests, and indexer unit/build and schema coverage are the acceptance surfaces for this dependency-only commit. Production dependency review remains tied to the exact lockfile and a current registry advisory snapshot.

## Historical moderate wallet-connector advisory

The production audit on 2026-07-16 reports two paths to the same moderate `uuid` advisory, [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq):

- `wagmi` → `@wagmi/connectors` → `@metamask/sdk` → `uuid@8.3.2`
- `wagmi` → `@wagmi/connectors` → `@gemini-wallet/core` → `@metamask/utils` → `uuid@9.0.1`

The affected behavior is limited to callers of UUID v3, v5, or v6 that provide an externally sized output buffer or offset. RMT does not call those APIs, does not expose a UUID buffer/offset interface, and does not use UUID values for wallet authority, trade calldata, identity, balances, or access control. The advisory therefore does not create a known exploitable RMT path.

The patched `uuid` line begins at `11.1.1`, while the affected wallet SDKs currently request older major versions. RMT does not force a cross-major override inside wallet SDKs because that could silently break connector behavior. Upgrade the upstream wallet connector packages when their reviewed dependency ranges include a patched UUID release, then rerun wallet connection QA, the production build, and the dependency audit.

This acceptance does not apply to new advisories, high or critical findings, use of the affected UUID APIs, or a change in wallet SDK data flow. Any of those conditions reopens the decision immediately.
