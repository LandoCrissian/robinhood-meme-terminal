# Dependency security policy

RMT installs production dependencies from the committed `pnpm-lock.yaml` with pnpm `10.12.1`. Project-level dependency overrides and lifecycle-script allowlists live in `pnpm-workspace.yaml`, which is the configuration source supported by the pinned pnpm release and newer pnpm clients.

## Enforced controls

- `postcss` is overridden to `8.5.10` and `ws` to `8.21.0` across the workspace.
- Only `esbuild` and `sharp` may run dependency build scripts.
- Optional native builds from `@reown/appkit`, `bufferutil`, `keccak`, and `utf-8-validate` are intentionally ignored because RMT does not require them for its browser or server release paths.
- CI runs `pnpm audit --prod --audit-level high` before typechecking or building the web application.
- Release verification must use `pnpm install --frozen-lockfile`; dependency upgrades require a reviewed lockfile change.
- The web app pins the modular Firebase SDK to `12.16.0`. Firebase is loaded only when the complete public web configuration is present; Firestore access remains restricted by the committed per-user rules.

## Accepted moderate wallet-connector advisory

The production audit on 2026-07-16 reports two paths to the same moderate `uuid` advisory, [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq):

- `wagmi` → `@wagmi/connectors` → `@metamask/sdk` → `uuid@8.3.2`
- `wagmi` → `@wagmi/connectors` → `@gemini-wallet/core` → `@metamask/utils` → `uuid@9.0.1`

The affected behavior is limited to callers of UUID v3, v5, or v6 that provide an externally sized output buffer or offset. RMT does not call those APIs, does not expose a UUID buffer/offset interface, and does not use UUID values for wallet authority, trade calldata, identity, balances, or access control. The advisory therefore does not create a known exploitable RMT path.

The patched `uuid` line begins at `11.1.1`, while the affected wallet SDKs currently request older major versions. RMT does not force a cross-major override inside wallet SDKs because that could silently break connector behavior. Upgrade the upstream wallet connector packages when their reviewed dependency ranges include a patched UUID release, then rerun wallet connection QA, the production build, and the dependency audit.

This acceptance does not apply to new advisories, high or critical findings, use of the affected UUID APIs, or a change in wallet SDK data flow. Any of those conditions reopens the decision immediately.
