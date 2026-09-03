# RMT universal execution fee V2 foundation

**Status: HISTORICAL FOUNDATION FOR CURRENT SHARED V2 POLICY**

Current owner product policy is `RMT_EXECUTION_V2` version 2: an atomic 25-basis-point input fee for independently admitted provider execution. Uniswap V3 V2 is public/live. Uniswap V2 V2 is deployed and controlled-live-proven but public-off pending a separate release. This foundation remains a historical design record; it does not admit another provider or replace provider-specific implementation, proof and release authority.

## Preserved V2 design record

`RMT_EXECUTION_V2` was designed as an additive universal policy for RMT wallet-executable trades on Robinhood Chain and is now the shared current policy. It charges exactly 25 basis points on gross input, with floor rounding and no minimum fee. The provider is quoted with `providerInput = userGrossInput - floor(userGrossInput * 25 / 10000)`. The fee and swap must settle atomically; a reverted or failed swap settles zero RMT fee. Discovery, search, quotes, simulations, approvals, ordinary transfers, and bridge/funding transactions are not fee-bearing.

V1 remains immutable historical policy and deployment evidence. V2 does not change its descriptor, policy hash, deployment manifest, or settlement receipts.

V2 deliberately has no per-token registry. A standard Robinhood Chain asset is bound and validated at execution time. Unsupported transfer behavior fails verification; it never creates a fee exemption.

The final V2 treasury and effective block are owner-reserved activation inputs, not foundation defaults. A candidate V2 policy requires a valid nonzero treasury that is not a Universal Router sentinel, and its policy hash binds that exact configured treasury and effective boundary. Missing activation configuration returns no active policy; partial or mismatched enabled configuration fails closed. The historical V1 treasury and artifacts remain unchanged and do not implicitly select the V2 treasury.

## Provider inventory at the foundation baseline

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

## Historical foundation admission design

The server-owned settlement registry has three conceptual outcomes: quote only, V2 atomic input fee, and (reserved for future review) other explicitly versioned modes. At this historical foundation baseline every provider was `QUOTE_ONLY`; later provider-specific admissions supersede that baseline without rewriting its design record.

If V2 is explicitly reauthorized in the future, this design requires all of the following before a provider becomes wallet-authorizable:

1. the exact active V2 policy is configured;
2. its reviewed V2 settlement implementation is registered;
3. its quote contains the planned V2 commitment;
4. strict verification proves the atomic settlement primitive;
5. the authorization binds the same commitment and proof; and
6. the wallet-signed transaction is the exact bound transaction.

Missing policy, configuration, commitment, proof, binding, or settlement registration fails closed. It cannot downgrade to a direct fee-free router. Quote-only attempts remain visible for price observation.

## Preserved implementation sequence

The sequence below records the prior design order. It is not the current roadmap and does not authorize implementation, deployment or activation.

1. Shared V2 policy, economics, settlement registry, admission and wallet contracts (this foundation).
2. Uniswap V3 universal atomic fee executor V2.
3. Sushi atomic fee executor, then amend draft PR #427 to use it.
4. UP V2 and UP CL atomic settlement.
5. Remaining provider-native settlement modes.
6. Post-fee route comparison and concise fee UI.
7. Contract deployment and read-only verification under a separate owner authorization.
8. Explicit owner production activation.

No effective block is selected, no contract is deployed, and no production configuration is changed by this foundation.
