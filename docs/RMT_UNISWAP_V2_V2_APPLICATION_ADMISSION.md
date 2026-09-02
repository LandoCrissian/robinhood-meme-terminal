# Uniswap V2 V2 application admission

`RMTUniswapV2FeeExecutorV2` is deployed on Robinhood Chain and recognized by the VNext source architecture. Deployment and source admission do not constitute public release.

## Immutable deployment

- Chain: `4663`
- Executor: `0xB4bF1d99a3BF9201f8197682dcD2bF97725D6230`
- Runtime hash: `0x3a0518035f7a47c752eba630e02db8a72b14c175977fbfcbf6d708ea1a36c647`
- Deployment transaction: `0xaeb0e8f4c235fa76136d52ce1563eeb5648dc9448d8b9dc888cdb554bb7b5aea`
- Deployment block: `52166832`
- Canonical manifest: `packages/contracts/deployments/rmt-uniswap-v2-fee-executor-v2.json`

The admitted settlement implementation is `rmt-uniswap-v2-fee-executor-v2`. It uses `RMT_EXECUTION_V2`, policy version 2, a 25-bps input-side fee, and the existing V2 treasury. The Solidity artifact is unchanged from the reviewed deployment artifact.

## Server-only release controls

All Uniswap V2 V2 execution controls are server-only:

- `RMT_VNEXT_UNISWAP_V2_V2_EXECUTOR_ENABLED`
- `RMT_VNEXT_UNISWAP_V2_V2_EXECUTOR_ADDRESS`
- `RMT_VNEXT_UNISWAP_V2_V2_EXECUTOR_RUNTIME_HASH`
- `RMT_VNEXT_UNISWAP_V2_V2_AUTHORIZATION_ENABLED`
- `RMT_VNEXT_UNISWAP_V2_V2_PROOF_WALLET`
- `RMT_VNEXT_UNISWAP_V2_V2_PUBLIC_AUTHORIZATION_ENABLED`

The default release scope is `DISABLED`. With authorization enabled and public authorization disabled, the scope is `PROOF_WALLET_ONLY` and requires the exact configured proof wallet. `PUBLIC` requires an explicit later public-authorization decision plus public provider-scope admission.

Production remains unchanged: its public execution provider scope is `[uniswap-v3]`, so Uniswap V2 remains quote-only for ordinary users. The deployed V2 executor is not a public execution authority by itself.

## Pre-sign authority

The strict V2 fee path verifies the executor and its immutable policy, Router, factory, pair-runtime and WETH dependencies before returning a wallet plan. Canonical WETH proxy runtime, EIP-1967 implementation and implementation runtime are checked at one block-pinned server snapshot. The verify-time block number and hash are committed into the short-lived HMAC continuity token. Authorization first re-reads that historical block to prove it remains canonical, then independently verifies the complete live executor and infrastructure authority at a fresh current block before returning either an approval or swap. The authorization block must be greater than or equal to the committed verification block; the two coordinates remain distinct in server evidence.

Authorization uses a dedicated one-shot browser transport with a bounded 30-second budget, no shared quote cache and no automatic retry. Indicative quotes retain their shorter request budget. An authorization timeout installs no wallet plan and requires verification again; attempt-epoch continuity prevents a late response from replacing a newer trade attempt. On the server, the historical verification block is reread only to prove its committed number/hash remain canonical. Complete Router, factory, WETH implementation, executor and policy authority is then proved once at a fresh current authorization block before simulation, gas estimation or wallet-plan return.

Native input targets the executor with gross input as transaction value. ERC20 input grants an exact gross-input approval to the executor, never to the Router; after approval the route must be verified again. Once atomic V2 settlement is selected, failures do not downgrade to direct fee-free Router execution or substitute another provider.

## Current state

- Deployment: complete
- Application source admission: complete
- Controlled live proof: not yet performed
- Public Uniswap V2 execution: off
- Production public provider scope: `[uniswap-v3]`
- Production mutation in this admission tranche: none

## Controlled Preview deployment identity preflight

Before a future controlled proof creates any Vercel deployment, record and verify the intended Vercel team, the exact RMT project ID and name, the repository root, the exact Git SHA, and `Preview` as the deployment environment. The target must be the RMT project and must not be the unrelated project named `web`. No proof configuration or deployment may proceed while any of those identities is implicit.
