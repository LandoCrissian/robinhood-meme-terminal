# RMT security remediation and release gates

**Task 080 · BLOCKED_NO_BROADCAST · internal engineering, not an independent audit.**

Baseline: draft PR#673, `526cf004d267596f6203f977be40439825f1204b`. The [original security task](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/673#issuecomment-6999758673) is narrowed by [the owner clarification](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/673#issuecomment-7000394798). Reclaim's permanent-surrender V2 is a **frozen trial**. Security corrections and tests are permitted; new Reclaim features, a dashboard redesign or production activation are not. NFT collection purchasing is the next separate bounded feature proposal, below. No real campaign, collection, reward token, reserve funding or production controller is approved here.

## Exact security scope and warning register

The reproducible [cross-module register](evidence/rmt-task080/findings-register.json) binds source/template/runtime references, compiler inputs, distinct analyzer inputs, exact detector IDs, external calls, protected assets, preconditions, existing mitigations/tests, uncertainty, owner decisions and release gates. Deduplication uses **analysis-input SHA256 + detector + exact finding ID**, never a shared description or presumed root cause.

| Scope | Lifecycle | Raw findings / High | Before → after High | Strict gate |
| --- | --- | ---: | ---: | --- |
| Fixed-supply4663 core and dependencies | Deployment-pinned; existing contracts unchanged |233 /22 |22 →22 | Failed |
| Project Treasury V1 | Asset-bearing, predeployment candidate |25 /6 |6 →6 | Failed |
| Reclaim V1 | Rejected historical escrow; not the active feature |28 /4 |4 →4 | Failed, retained |
| Permanent Reclaim V2 | Frozen, isolated trial |45 /7 |7 →7 | Failed |
| Treasury purchase V2 prototype | Nonspending reference/route model |3 /0 |0 →0 | Narrow analysis passes; execution remains NO-GO |

There are **334 raw rows**,39 exact scoped High observations and49 detailed records, including seven previously assessed governance Mediums and the prototype's three lower observations. The remaining285 lower rows stay indexed and explicitly undispositioned, including59 Mediums. Four of the39 Highs concern rejected historical Reclaim V1. Warning counts are not exploit counts; **no High is independently cleared**. The repository-tree security job is retained separately; a gate pass in a narrower scope cannot clear another artifact or the known parser gaps.

The register inherits prior internal pinned-path assessments as historical evidence, not as fresh independent clearance. A detector's external-call/balance pattern is real source dataflow. Whether it permits loss depends on concrete runtime, authority, callers, state and dependencies. Confirmed material defects and unresolved plausible material loss paths block the affected release. A paid audit is not a mandatory procurement condition; passing tests or owner approval cannot manufacture missing evidence.

## Seven active Reclaim V2 observations

The exact six-source production compiler input remains **`fece6e205ff52f8369c732cbddaa663a0d19530062b7539dc4b4467099a08cdc`**. Fresh local Slither0.11.5/Crytic0.3.11 ran all101 detectors with no source/severity/detector filters:45 findings,7High/1Medium/29Low/7Informational/1Optimization, strict exit1. All45 finding IDs match Task079. Compiler0.8.26, Cancun, optimizer200, viaIR and dependency/source bindings are unchanged. Windows compiler SHA256 is `537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67`; Linux has its separately pinned executable hash. [Raw report, input, full individual boundaries, tool versions and scan provenance](evidence/rmt-task080/security/reproduction.json).

| Boundary | Observed call and assertion | Asset/authority assumptions | New targeted evidence |
| --- | --- | --- | --- |
| `_pull`: campaign balance | Standard ERC20 `transferFrom`, exact campaign credit | Verified fixed-supply TokenV2, guarded funding | Independently falsify recipient credit while sender debit is correct; exact rollback |
| `_pull`: sender balance | Same call, exact sender debit | No hidden tax, callback, rebasing or dishonest balance reporting in admitted token | Independently falsify sender debit with correct campaign credit |
| `_pay`: recipient balance | Standard ERC20 `transfer`, exact beneficiary credit | Reward claimant or noticed reserve controller; no caller redirect | Correct campaign debit with wrong recipient credit must revert |
| `_pay`: campaign balance | Same call, exact reserve debit | Guarded effects and actual funded reserve; no unpaid acceptance | Correct recipient credit with wrong campaign debit must revert |
| `_burn721`: actor balance | Native burn, exact actor decrement plus supply/owner absence | Admitted immutable non-remintable NFT implementation | Correct burn/owner/supply result with inconsistent actor balance must revert |
| `_sink721`: sink balance | Safe transfer, exact sink credit and ownership | Exact immutable sink; issuer cannot seize, recover, upgrade or approve for it | Correct owner and source decrement with wrong sink credit must revert |
| `_sink721`: actor balance | Same transfer, exact actor decrement and unchanged supply | Same admitted source/receiver authority | Correct sink credit with wrong actor debit must revert |

The full IDs and original source locations are in the machine register and fresh reproduction, not replaced by table labels. Eighteen new tests in [Reclaim security boundaries](../packages/contracts/reclaim-v2/test/RMTReclaimV2BoundarySecurity.t.sol) isolate these seven assertions, precise callback rejection, atomic rollback, interrupted retirement, replay, unsupported issuer runtimes and forced assets. Their hostile dependencies are **counterfactual test fixtures**, not admitted real collections. Tests do not prove universal non-exploitability of arbitrary contracts.

No concrete asset-loss defect was established in the admitted V2 source/profile during this review, and no production Solidity change is proposed. Exact before/after token, ownership, supply and sink checks and reentrancy guards remain. ERC1155 array-held baselines may have less precise static dataflow coverage even though the closure parses; separate tests retain their exact deltas. Historical V1/V2 curve-funding parser limitations remain disclosed. All62 preexisting Solidity files and existing production manifests/beneficiaries remain unchanged.

## Concrete verification-policy corrections

### Owner-controlled Reclaim administration

Previously, the local dashboard exposed administrative preparation too broadly, including raw methods whose immutable contracts permit permissionless execution or expired-notice cancellation. This was an application-policy gap, not a demonstrated NFT custody escape. The existing contract `onlyController` permissions were not removed or broadened.

New administration preparation/revalidation requires a bounded, server-only `RMT_RECLAIM_ADMIN_POLICY` file with exact chain31337, factory/runtime and explicitly admitted controller/runtime identities. Missing, malformed or mismatched policy fails closed for administration. No production address is inferred from the personal deployer, governance owners or fee beneficiaries. Current campaign controller and runtime are read onchain; proposed/incoming controllers require admission, and acceptance checks the actual pending controller, epoch and notice window.

The UI uses verified authority to expose the existing controls. A connected Safe gas payer is not a Safe owner. Safe administration requires an actual current owner for proposal preparation; two owner approvals remain required, while the separately bound outer gas payer can execute the approved call. Public eligibility, the participant's own surrender and historical transaction recovery are retained. Revoking dashboard admission blocks new preparation/revalidation but does not delete journals or invent a failed canonical receipt.

Unsigned `eth_call` or a JSON actor address is **not authentication of ownership**. The wallet still binds the account/chain/runtime and explicitly signs the exact transaction; Safe calls require their two valid owner approvals. The server never signs. This policy restricts RMT's dashboard; it does not claim to change the immutable factory's permissionless creation or raw permissionless execute/cancel semantics.

### Transaction-envelope admission

The indexer's origin verifier previously checked call/nonce/canonical membership and before/after account code, but omitted the type2/no-delegation/no-access-list envelope restriction already enforced by wallet receipt verification. A canonical-shaped provider double with unsupported type4 metadata and otherwise valid Safe evidence was accepted. The new negative test **failed before** with `Missing expected rejection: delegation-format` and passed after the guard.

Origin verification now independently requires ordinary EIP1559 calls, absent delegation authorizations and no access-list entries. This still supports an already pinned EIP7702 account sending a normal type2 call; it never changes delegation. Safe and direct ERC721/1155 burn/sink proof tests reject legacy/type4, authorization lists, populated or malformed access lists. This is an unsupported-origin classification correction, **not proof of public-chain exploitation or a reduction in Slither findings**. [Before/after evidence](evidence/rmt-task080/verification-policy.json).

## Permanent-retirement and settlement limits

Native burn and immutable-sink profiles require reviewed source/runtime and actual authorization semantics. ERC165, a burn selector, Transfer-to-zero or a conventional dead address alone is insufficient. Remint, issuer seizure, operator bypass, mutable implementation/validator or unproven recovery powers require rejection or an unresolved admission decision. EIP7702 cannot simply replace arbitrary deployed sink code; actual target-chain EVM/runtime and collection authority still need exact verification. NFT reorg rollback is separate from accepted irreversible retirement after the required finality.

No real collection is admitted. The retained [LAMMB source/authority observation](evidence/rmt-task047/lammb-royalty-authority.md) identifies a fixed-target clone, partial implementation verification and mutable royalty/transfer-validator settings at its recorded block. It does **not establish** non-remintability or absence of every recovery power. This is insufficient for Reclaim admission, not a claim of an exploitable LAMMB defect or permission to alter its royalties. Future NFT purchase eligibility has a distinct scope from permanent-retirement eligibility.

Multi-transaction-per-block acceptance is not added under the feature freeze. Current exact local balance attribution explicitly requires a single-transaction block. Unproven traces, ambiguous intra-block changes, malformed/missing receipts, provider disagreement or missing archive state remain unavailable/pending. Net block-end balances do not prove the reviewed transaction's exact settlement. No automatic retry, signature or broadcast is introduced. PostgreSQL checkpoints/replay/reorg and original Safe inner/outer identity stay separate from independent Ethereum L1 finality.

The [earlier failed WebKit run and deterministic Windows diagnostic](evidence/rmt-task079/failed-before/linux-webkit-lifecycle-failure.json) remain intact. A caught same-origin fetch can produce WebKit's native access-control pageerror during document replacement without any API dispatch. Full Linux overlap timing remains unproven; no application defect is inferred solely from that match. No pageerror filter or relaxed financial assertion is added. Physical iPhone acceptance remains unverified.

## Execution evidence and reproduction

Local checks already completed: fresh full V2 static analysis (strict failure), pinned solc syntax/type checks for the18 new tests, six register-generator/tamper checks, focused administration/client/Safe tests, and indexer format/permanent-retirement proof tests. These provider-double/unit checks are labeled separately from actual Anvil receipts and database/browser acceptance.

Native Forge/Anvil executables from the earlier temporary installation are unavailable on this Windows session. No replacement runtime, service or paid resource was installed. Actual new Foundry execution and full Chromium/WebKit/PG18.6 lifecycle runs are **pending the existing Linux CI** at this initial handoff snapshot. A passing old Task079 run is not substituted for the changed dashboard. Final exact source, test counts, receipts/screenshots and CI links will be recorded on the stacked draft PR and in this package after execution; pending is not passed.

```sh
node scripts/security/findings-register.mjs --check
node --test scripts/security/findings-register.test.mjs
pnpm --filter indexer typecheck
pnpm --filter indexer test:resilience
pnpm --filter @rmt/launch-website test:history
forge test --root packages/contracts/reclaim-v2 --use /path/to/pinned-solc-0.8.26 -vvv
node scripts/visual-qa/rmt-creator-integration.mjs --reclaim-only \
  --anvil /path/to/anvil-1.7.1 --solc /path/to/pinned-solc-0.8.26 \
  --pg-bin /path/to/postgresql-18.6/bin --browser chromium --output /tmp/rmt-task080
```

Repeat the browser command with WebKit and a distinct output path. The existing workflow separately runs all creator, claim/profile and treasury regressions, public read-only route negatives, Firebase emulators, builds, dependency/secret checks, core Foundry and every strict analysis scope. Preserve every failure rather than treating these commands as release approval.

## Minimum production acceptance, by affected stage

1. **Core launchpad:** resolve or evidence-disposition plausible material loss paths for the exact deployed/pinned artifact under the owner risk policy; retain raw failed static gates. Recheck actual dependencies/runtimes, canonical constructor/governance receipts and current authority. Preserve real notices and separate owner approval of each action. No repeated deployment, automatic RMT issuance or assumed bytecode equivalence of a changed build.
2. **Wallet/backend:** actual supported physical wallet transaction review and hash recovery; archive/trace/provider disagreement handling; durable backups/restore, one indexing writer and recovery; explicit unverified L1 state until independent finality verification exists. Production flags and each financial activation need their separate approval. Existing read-only website operation is independent of optional Reclaim/NFT modules.
3. **Project Treasury:** retain creator/beneficiary entitlements, supported asset custody and independent withdrawal/claim approval. V1 and the nonspending V2 prototype do not gain purchases by toggling UI settings. Native/token royalty receipts and spendable assets remain separate; original LP principal never funds purchases or costs.
4. **Frozen Reclaim trial:** material security disposition, actual future RMT identity, independently established irreversible collection/ID policy, fixed units/caps, explicit controller and separate manual funding/activation approval. No real inputs assigned. Current single-transaction proof and physical-wallet limitations prevent claiming general production acceptance.
5. **No mandatory paid procurement:** use existing free tools/evidence. An internal review is not an independent audit. No security exception may authorize a confirmed exploit, fill missing evidence, redirect funds or broaden an immutable commitment.

## Next separate bounded feature proposal: NFT collection purchasing

After this security work, propose a separate stacked task for the **existing Project Treasury dashboard**, not a general NFT marketplace or Reclaim expansion:

- Safely resolve an official OpenSea collection URL or verified contract input to exact chain and all collection contracts. Reject ambiguous/cross-chain/unsupported identities; never execute a URL or arbitrary fetched target. Verify source/authority, ERC721/1155 behavior and payment/listing compatibility. Require confirmation of exact addresses. Token IDs/traits are selectable only with independently verifiable evidence.
- Independently configure collection admission, purchase budget, per-NFT cap, aggregate caps, approved route and an OFF-by-default purchasing switch with immediate creator stop. Own-token buybacks retain their separate NO-GO flag and independent project-token price gate; NFT controls must not silently enable them.
- Validate exact signed listing/order, current owner, consideration/recipient, expiry/nonce, marketplace/conduit/operator approvals, royalties/fees, total cost and bounded execution. Fail closed on missing order evidence or unsafe route. Use isolated synthetic orders/official fork contracts before any separately authorized live action.
- Purchased NFTs remain in separately accounted project custody. Record actual ownership/quantity, payment and canonical receipt before success; preserve recovery/reorg and project authorization. No automatically reciprocal RMT/LAMMB spend, royalty redirect or hidden principal withdrawal. The LAMMB example is a possible creator-approved collection policy, not a special integration or spending approval.
- No hosting upgrade, paid API/service, new production wallet, mainnet order, signature, purchase or deployment is authorized by this proposal. Existing free access may leave some marketplace adapters unsupported; report exact evidence gaps.

This is the next task definition, **not implemented NFT purchasing or current purchase authorization**. No production publication, database migration, paid service, contract broadcast, wallet signature, fund movement or royalty change occurred in Task080.
