# RMT universal execution fee V2 foundation

Status: foundation only; no V2 executor is deployed or production-active.

## Owner policy

`RMT_EXECUTION_V2` is the additive forward policy for every RMT wallet-executable trade on Robinhood Chain. It charges exactly 25 basis points on gross input, with floor rounding and no minimum fee. The provider is quoted with `providerInput = userGrossInput - floor(userGrossInput * 25 / 10000)`. The fee and swap must settle atomically; a reverted or failed swap settles zero RMT fee. Discovery, search, quotes, simulations, approvals, ordinary transfers, and bridge/funding transactions are not fee-bearing under this policy.

V1 remains immutable historical policy and deployment evidence. V2 does not change its descriptor, policy hash, deployment manifest, or settlement receipts.

V2 deliberately has no per-token registry. A standard Robinhood Chain asset is bound and validated at execution time. Unsupported transfer behavior fails verification; it never creates a fee exemption.

## Current executable-provider inventory

| Provider | Adapter | Quote | Strict verification | Wallet authorization after this foundation | Exact current wallet target | Current fee commitment / settlement | Atomic RMT fee in exact wallet transaction | Current bypass class | Required V2 implementation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `uniswap-v3` | `apps/web/lib/server/vnext-uniswap-v3-adapter.ts` | yes | yes | no | V1 executor `0xcB9c00524848038D211921e0f3975190D7Aa1e8f` for admitted V1 assets; otherwise Router02 `0xcaf681a66d020601342297493863e78c959e5cb2` | V1 is atomic only for its static admitted settlement assets; disabled economics permits a direct-router plan | partial, not universal | missing/misconfigured/ineligible V1 settlement can select direct Router02 with no RMT fee | universal Uniswap V3 atomic input-fee executor V2 |
| `up-v2` | `apps/web/lib/server/vnext-up-adapter.ts` | yes | yes | no | `0xf5198743240fAC98db71868F34c70139b1eb0474` | disabled fee economics; direct router | no | direct wallet authorization is fee-free | UP V2 atomic input-fee settlement |
| `up-cl` | `apps/web/lib/server/vnext-up-adapter.ts` | yes | yes | no | `0xC062b870E813fcA720f1e002c234369Ab3aB9415` | disabled fee economics; direct router | no | direct wallet authorization is fee-free | UP CL atomic input-fee settlement |
| `sushi` | `apps/web/lib/server/vnext-sushi-adapter.ts`; draft PR #427 adds verification work | yes | no on main | no | draft #427 targets RedSnwapper `0x8E6fD69A77e88ee20Ba4B4fBd59DfCDA3EC0E98A`, which delegates to executor `0x0e867974275cd31c25015c2753c9d75f9f355379` | disabled RMT economics in draft #427 | no | direct RedSnwapper execution would be fee-free | Sushi atomic input-fee executor around the audited route |
| `uniswapx` | `apps/web/lib/server/vnext-uniswapx-adapter.ts` | yes | no | no | none; observation/intent foundation only | no V2 commitment | no | none exposed because wallet authorization is absent | provider-native/order settlement proving V2 atomically |
| `zero-x-swap` | `apps/web/lib/server/vnext-zero-x-adapter.ts` | yes | no | no | none; allowance-holder price observation only | provider fee fields are not an RMT V2 commitment | no | none exposed because wallet authorization is absent | verified 0x settlement binding exact V2 fee |
| `zero-x-gasless` | `apps/web/lib/server/vnext-zero-x-adapter.ts` | yes | no | no | none; gasless price observation only | sponsorship/provider fees are not an RMT V2 commitment | no | none exposed because wallet authorization is absent | verified gasless settlement binding exact V2 fee |

The presence of normalized economics is not settlement proof. Wallet admission requires the exact signed transaction to use an explicitly registered V2 settlement implementation and bind the active policy, economics, settlement proof, authorization, execution target, provider target, calldata hash, recipient, deadline, and execution ID.

## Foundation admission rule

The server-owned settlement registry has three conceptual outcomes: quote only, V2 atomic input fee, and (reserved for future review) other explicitly versioned modes. Every current provider is `QUOTE_ONLY` in this tranche.

A provider becomes wallet-authorizable only when all are true:

1. the exact active V2 policy is configured;
2. its reviewed V2 settlement implementation is registered;
3. its quote contains the planned V2 commitment;
4. strict verification proves the atomic settlement primitive;
5. the authorization binds the same commitment and proof; and
6. the wallet-signed transaction is the exact bound transaction.

Missing policy, configuration, commitment, proof, binding, or settlement registration fails closed. It cannot downgrade to a direct fee-free router. Quote-only attempts remain visible for price observation.

## Implementation sequence

1. Shared V2 policy, economics, settlement registry, admission and wallet contracts (this foundation).
2. Uniswap V3 universal atomic fee executor V2.
3. Sushi atomic fee executor, then amend draft PR #427 to use it.
4. UP V2 and UP CL atomic settlement.
5. Remaining provider-native settlement modes.
6. Post-fee route comparison and concise fee UI.
7. Contract deployment and read-only verification under a separate owner authorization.
8. Explicit owner production activation.

No effective block is selected, no contract is deployed, and no production configuration is changed by this foundation.
