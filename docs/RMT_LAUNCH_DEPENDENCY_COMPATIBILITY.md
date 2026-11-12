# Launch dependency and CannaCat compatibility evidence

The launch branch started at `ae504c8a6851a96d3a0bda9861551e8ec1d04385`. The dependency update is `f5aed1b5c98a747f36031b8df8d8b6abf7cc000e`.

## High advisory remediation

- Zod `4.6.6` resolves both the direct web path and the Reown wallet path. The parser changes make missing DeFiLlama fields explicitly optional and preserve the Blockscout wallet-constellation pagination map with an explicit string key schema. Both parser changes match the behavior in PR #575. [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- WalletConnect's `query-string` `7.1.3` uses the fixed `decode-uri-component` `0.5.1`. A one-line pnpm patch selects the ESM default export from the existing CommonJS consumer on Node 22. The wallet gateway smoke exercises the installed Wagmi and WalletConnect dependency chain with valid percent-encoded pairing data and malformed input. Both upstream packages carry MIT licenses. [Decoder advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f)

The frozen install and `pnpm audit:production` passed. The audit reported zero high or critical findings, three moderate findings, and one low finding. The launchpad and MCP suite passed all nine checks. The web TypeScript check, wallet gateway, wallet constellation, and four DeFiLlama smokes passed.

## Detached PR #575 compatibility candidate

The test candidate `18116180adcb064cde4e304ee97236200ecd1c11` applied the three-way source result from the dependency update and PR #575 head `5ee50aa9a776dfa70cc2708ba7fa57394c0b229d` in a detached local worktree. The original PR and launch refs stayed separate. [PR #575](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/575)

For a future integration, preserve the launch root manifest and its lockfile together. This retains Next `15.5.29`, the launch MCP dependency, the advisory overrides, and the decoder patch. Keep the launch web manifest and add the exact CannaCat build and smoke scripts from PR #575 alongside their source files. The two parser conflicts are caused by line endings. Their contents matched after normalizing CRLF to LF, and the candidate retained the launch copies. The candidate used the exact launch lockfile Git blob `4c488ab6dd1ea3bdf0c11fbac96e3b4ae80a530a`, which installed with `--frozen-lockfile`.

The candidate passed the 146 embed-boundary checks, 237 official settlement trace checks, 28 historical settlement checks, and the CannaCat SDK build. The historical checks used the public receipt and trace with a representative journal. This evidence covers the dependency and source combination in the detached candidate.
