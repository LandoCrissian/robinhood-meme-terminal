# Task 091 evidence

[One-page release decision](../../RMT_TASK091_RELEASE_DECISION.md) is the operative handoff. These producers and saved results establish bounded facts; none grants signing, broadcast or website activation authority.

| Package | Reproducible result |
| --- | --- |
| [Security](security/README.md) | All 22 exact High IDs and seven governance Mediums retained; four explicit stage recommendations, source/runtime arguments and residual risks. Four new real-runtime admission/signature/NFT cases pass in both profiles. Complete gzip traces retained. |
| [Governance](governance/README.md) | 206 + 114 raw official/Pocket requests, exact deployed identities and current authority, original pending action, full unsigned publication packet and ten offline refusal/replay tests. Exact explorer verification submissions publish existing public source only; captured transient fields are not execution-time approval. |
| [Journey](journey/README.md) | Seven downloaded exact-head CI ZIPs with API digest correspondence; eleven selected raw reports, 321 assertions, complete synthetic 2 ETH lifecycle and delegated/Safe beneficiary claims. No production lifecycle or physical-device claim. |
| [Operations](operations/activation.md) | Current provider identities and binding metadata, verified absent backups/PITR, exact READ ONLY writer observation and the minimum activation procedure. Unperformed owner actions remain explicit. |

The new draft is based on `27f19787ed0a2d904ba4508d2adfab1773e82e67`. No first-party production Solidity, fixed economics, dependencies, authentication or scanner policy changed. The website claim-readiness explanation now identifies the missing implementation; its literal production execution switch remains false. CI adds the four new cases to the original 20 proofs in both profiles and retains all existing regressions and severity gates.

Offline reproduction after installing the existing pinned dependencies:

```powershell
node --test scripts/release/verify-task091.test.mjs
node scripts/release/verify-task091.mjs
node --test docs/evidence/rmt-task091/governance/review-packet.test.mjs
node docs/evidence/rmt-task091/journey/verify-journey.mjs
node docs/evidence/rmt-task091/operations/verify-operations.mjs
pnpm test:release-policy
pnpm --filter @rmt/launch-website test:history
pnpm check:repo
```

Local results: verifier **10/10**, governance **10/10**, release-policy **30/30**, website **327/327**, all zero failures/skips; repository check and website typecheck pass. The new admission producer records **4/4 per profile**, zero failures/skips. Hosted CI must be evaluated on the draft's exact published head; retained base-head successes are labeled separately, and strict raw security failures are not converted into green checks.

Task 091 used bounded nonsecret account/RPC inspection and normal explorer publication of already-public source verification inputs. No wallet signing/broadcast, token creation, database mutation, secret rotation or hosting deployment occurred. On-chain factory publication remains a separate owner-controlled irreversible decision.
