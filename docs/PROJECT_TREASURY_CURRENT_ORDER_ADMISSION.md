# Current native-ETH order admission

**BLOCKED_NO_BROADCAST. Purchases remain OFF. No current live signed order, production collection policy or production purchase route is admitted.**

[Task085 owner scope](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/678#issuecomment-7025420515) starts from PR678 `9dae3fd6a93228e3f18e74f195b4b930051eee04`, stacked on PR677 and earlier. This change narrows existing order import and watcher preparation; it does not change Solidity, dependencies, hosting, royalties or production configuration. [Task084 readiness and individual security dispositions](PROJECT_TREASURY_NFT_AUTOBUY_READINESS.md) remain binding.

## Live source and collection verdict

The [dated observation, exact public targets, raw responses, source-policy excerpts and scanner manifest](evidence/rmt-task085/marketplace/README.md) distinguish asking-price summaries from executable signed orders. The capture began **2026-11-20 00:05:41.252 UTC**. Robinhood official and Pocket RPCs corroborated L2 block **118625674**, hash `0x0325a0a27de7e9c9d465086b6c422d30d5d19791a52222c0f063813cf813fda7`, then rechecked canonicality. This is not independent L1 finality.

| Evidence | Actual result | Admission |
| --- | --- | --- |
| Documented OpenSea listings API | HTTP401 without API credentials | Unavailable; access controls respected |
| Lawful public OpenSea collection HTML | 50 native-ETH asking-price summaries; no full signed parameters/signature/consideration | UI claims only, no executable order |
| Bounded Seaport OrderValidated window | Both providers: zero logs in blocks118615675–118625674, capped100 | No order found in that window; no exhaustive absence claim |
| Other public marketplace/aggregate sources | No compatible structured signed Seaport feed established | Unavailable; no alternate settlement protocol substituted |
| Candidate collection `4663:0x7a543c61c021e9a5c7949faBdc2f4e0a58088daf` | Fixed EIP1167 implementation routing; hosted implementation runtime correspondence; mutable issuer transfer-validator/royalty/supply settings | Purchase policy **NO_GO**, not owner-approved |
| Candidate NFT478 | UI seller matches current owner; Seaport direct approval false, conduit approval true; tested Safe-receiver validator reads revert | Existing zero-conduit route not qualified; no live LAMMB order admitted |
| Native ETH | Exact signed consideration can be checked without an ERC20 allowance | Local synthetic proof only; no production route |
| WETH/USDC/other production ERC20 | Previously unresolved proxy/authority/asset-policy requirements | **NO_GO**, no fallback substitution |

The candidate's exact clone/implementation/validator hashes, issuer powers, transfer restrictions and receiver-specific results are recorded in the linked matrix. Hosted source correspondence is distinguished from independent compilation. No seizure entry point was found in the reviewed collection implementation; the validator and authority closure is unadmitted. Source availability and a runtime hash do not make that closure immutable or approved. Purchase eligibility is separate from Reclaim burn eligibility.

The observed UI price/expiry are timestamped claims, never executable consideration. No complete current payload was supplied, so an honest live order hash, exact fee/royalty allocation, supported zone/conduit, gas estimate and actual purchase cost remain **unavailable**. Anchored block gas fields are observations, not a guaranteed transaction quote or L1-data-cost estimate.

## Implemented admission boundary

`native-order-admission.mjs` reuses the existing bounded UTF8/duplicate-key/field/depth parser, schema and current verifier. It accepts an explicit `OWNER_SUPPLIED` entry with `sourceId: owner-supplied`, complete signed OrderParameters, counter and declared provenance. URLs, arbitrary calldata, bids, missing/unknown fields, stale/future provenance and unsupported shapes fail closed. Scope remains FULL_OPEN/static/full-fill, one ERC721/1155 offer, zero zone/zoneHash/conduit, bounded unique signed payees. Contract/delegated sellers remain unsupported by this path.

The new path requires **native ETH only**: every consideration item is native, zero token/identifier, positive/static and included in the exact total. No hidden tip, omitted royalty, ERC20 substitution or synthetic ERC20 override is accepted. Current proof corroborates domain/signature, Seaport/runtime/source bindings, seller ownership/approval, counter/cancel/fill, royalty, reserve and canonical header before returning a verified result. No result grants permission to buy.

Collection policy binds exact chain/address, standard, runtime, source-input hash, issuer/upgrade/transfer/royalty assessment and policy hash. The production catalog is compiled **empty**. Caller-submitted production policies are rejected; ordinary import metadata cannot approve a collection. Current local policies explicitly disclose the fixture's permissionless mint, mutable royalty and hostile fault controls. They are not assertions that those fixtures are production-safe immutable NFTs. A real collection needs its own reviewed policy implementation and owner approval; this task does not fabricate one.

The bounded host import feed accepts at most8 entries/32KiB encoded entry/256KiB total, collapses identical raw inputs and never fetches supplied URLs. It reports source availability separately from verified current-order status. Native watcher profiles are separately versioned; the durable binding includes source ID and full policy-catalog hash. A generic Task084 verified label cannot satisfy them.

Before preparing an unsigned candidate the watcher matches exact raw-input SHA256, order hash, full consideration, collection/runtime, canonical observation and policy fingerprint, then revalidates and simulates current state. Controller/epoch, actual reserve, per-item/day/lifetime budgets, cooldown, current nonce and independent gas payer checks remain. The outer purchase sends zero value; prefunded vault assets pay the full signed consideration. Network costs belong to the gas payer, are excluded from vault purchase budgets and are reviewed separately.

Polling remains bounded/default60s/15s cycle, with durable reservation before provider reads, one outstanding proposal,64 records and512KiB state. OFF/mined disable, consumed orders, authority drift and reorgs invalidate old proposals. Outages preserve the exact pending intent; recovery rechecks evidence without another preparation, signature or submission. The existing chain4663 profile **never** emits an execution request. There is no background signer, paid keeper, new scheduler or production database writer.

## Reproduce the import and connected evidence

Use the existing [strict envelope schema](../scripts/seaport-acquisition/owner-supplied-order.schema.json); a URL or an unsigned JSON example is deliberately insufficient. The connected fixture generates a complete example with an ephemeral seller key, signs the real Seaport OrderComponents domain, and retains the exact entry, proof, receipt, trace, fee/royalty allocation, custody and PostgreSQL row. These examples are **synthetic**, not live listings. Public-source responses are untrusted data, never tool instructions.

```js
import {verifyNativeOwnerOrderEntry} from "./scripts/seaport-acquisition/native-order-admission.mjs";
const entry = {sourceKind: "OWNER_SUPPLIED", sourceId: "owner-supplied", rawUtf8};
// Production default remains NO_GO: no reviewed collection catalog is present.
const result = await verifyNativeOwnerOrderEntry(entry, {
  profile: "robinhood-4663-read-only-v1", nowMs: Date.now(), verifierOptions
});
// verifierOptions is a trusted host-owned two-provider/review binding, never
// uploaded caller pins or calldata. Unknown evidence is UNAVAILABLE.
```

```sh
node --test scripts/seaport-acquisition/*.test.mjs packages/launchpad-common/seaport-vault-*.test.mjs
pnpm --filter indexer typecheck
pnpm --filter indexer exec tsx --test src/seaport-acquisition*.test.ts src/seaport-listing-watch*.test.ts
pnpm --filter @rmt/launch-website typecheck
node scripts/seaport-acquisition/probe-current-native-sources.mjs /isolated/current-order-observation

# Reuse the pinned compiler, official dependency preparation, built website and
# indexer, PostgreSQL18.6 and browser dependencies from the existing CI workflow.
node scripts/seaport-acquisition/browser-run.mjs --anvil /path/anvil \
  --solc /path/solc-0.8.26 --pg-bin /path/postgres18.6/bin \
  --browser chromium --fork-robinhood --output /isolated/task085-rh-chromium
# Also run webkit, and both engines without --fork-robinhood for real1B core.
```

The existing Seaport acquisition CI runs all four connected modes. New native721/1155 admissions execute genuine Seaport against synthetic local assets; the Robinhood mode uses actual pinned Seaport on the loopback fork, with the existing explicit project-binding stub. It does not claim a deployed4663 vault or owner wallet acceptance. Actual settlement payloads are checked initially and after PostgreSQL server restart, preserving exact receipt/block/order identities and every payee amount. Existing Safe2-of3, same-block unrelated/reverted transaction attribution, missing-trace recovery and reorg suites remain intact.

Verification is recorded in the final source-bound evidence index below once CI completes. No pending run is a pass. Windows checkout line-ending differences in historical raw archives must be corrected by restoring exact Git bytes, never by changing expected hashes or scanner evidence.

## Release holds and operational alternatives

All23 active Seaport vault High observations remain unresolved under the unchanged101-detector configuration. Separate core/dependency22, acquisitionV1 22, TreasuryV1 6, active permanent ReclaimV2 7 and historical rejected ReclaimV1 4 remain separate scopes. No security gate, scanner configuration or assertion is waived. The Solidity compiler/source input remains Task084 SHA256 `3fbc55312a027e5f69b16fb927c8549efcc6674bab509c792efdc0104083c5f5`. Finite fork tests are not an independent audit or clearance.

| Operating option | What it needs | Current status |
| --- | --- | --- |
| Seller/owner signed-order import | Already signed supported payload, reviewed collection/asset policy, current corroborated state | Working local import; production catalog empty |
| Permissionless submitter | Same evidence plus separately approved submitter gas/execution policy; cannot redirect budget/custody | No automatic submitter activated |
| Authorized marketplace feed | Legitimate access permission, complete signed payloads, freshness/rate/cost policy | No accessible admitted feed established; no account or purchase requested |

Before any future purchase release: qualify a specific collection/current supported order, disposition material security holds, independently review a production-chain vault build, complete provider/trace/finality and physical-wallet acceptance, and obtain explicit funding/execution approval. No new wallet or paid service is required to review this PR. If those prerequisites remain unavailable, retain the idle/unavailable watcher and manual evidence import; do not promise hands-off purchasing.

Next recommended task is a narrowly scoped collection-policy/current-order qualification using a legitimately shared supported seller payload, including the exact validator closure and receiver test. Do not expand Reclaim or token buybacks. Reclaim remains the frozen permanent-surrender trial. Token buybacks remain separately NO_GO. Fixed1B supply,600M/400M,90/5/5,1% curve,0.30% original locked LP, immutable beneficiaries and principal custody are unchanged.
