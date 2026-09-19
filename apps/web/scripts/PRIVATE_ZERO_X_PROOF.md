# Private current 0x proof

This is a one-shot server command, never a public endpoint or application lifecycle hook. It calls the existing price adapter and strict firm verifier, including normal provider-wrapper validation, registry eligibility, reviewed runtime admission, executable-minimum decoding and exact simulation. It never calls authorization/commitment creation, a signer or a transaction submission method. Importing the file does not run the matrix.

Authorized source base for this work: `aefc2a2fb4da7a38213e9fecd58914577b560858` (PR527 rebase result). Record the separately reviewed proof PR head and exact execution environment; the base label is not proof of deployed bytes.

## Run only in an already authorized server environment

From `apps/web`, with its existing server environment in place:

```sh
pnpm proof:zero-x:private --execute-read-only
```

No `.env` loading, environment export/pull, credential copying or secret command-line arguments. Missing/malformed credentials, RPC override, provider scope or firm configuration fail before traffic. API-key presence is not validity. No release flags are changed. The CLI flushes a sanitized JSON result and exits; its 180-second watchdog prevents a recurring/orphan process. Three fixed cases, one price and at most one firm request per case, no proof retries. Existing bounded identity/Stock Token/project-conflict reads and chain-clock checks remain. Project revalidation is owned and awaited before quotes; no background process survives exit.

The public read-only taker is the previously used RMT treasury address. This does not assert a funded wallet or authorize spending its balance. Cases: 0.001 native ETH -> USDG, 5 USDG -> native ETH, 5 USDG -> canonical WETH. Native ETH and WETH remain separate assets. No route for the last pair means only that pair/amount lacks a route. All cases retain live identity and Stock Token admission. Missing enrichment is not converted into policy denial.

The indicative floor is the actual admitted price result. Missing/expired price skips firm verification; no synthetic floor, state override, changed slippage, allowance or balance is used. The firm observer adds two block-header reads around the existing block-pinned registry/Settler-code reads and rejects a changing block hash. These diagnostic reads can consume part of the unchanged ten-second verifier TTL; an expiration remains a failure, never a reason to relax it. Normal production calls without an observer perform no additional reads.

`firmStatus=FIRM_QUOTE_RETURNED` records provider HTTP success, not successful parsing or executable admission. `failureClass` records the actual subsequent boundary. `feeEvidence` distinguishes requested fee from strictly validated quoted fee; neither proves settlement. `RMTExactSimulationState=NOT_RUN` includes insufficient funds/allowance, incomplete provider simulation and earlier verifier rejection. `VERIFIED` is read-only verifier evidence, never wallet/trading acceptance. Indicative transport errors retain the existing adapter's broad unavailable classification; only the firm path distinguishes HTTP429 explicitly.

An unsupported decoder may reject before a Settler can be decoded; do not substitute `ownerOf(2)` for the unknown quote target. Registry observations are emitted only after valid current membership (or justified previous membership), runtime bytes and stable header hashes. A paused/malformed current entry never consults previous. Unadmitted runtime evidence is reported before the existing rejection; admission remains unchanged. AllowanceHolder runtime verification is unchanged and may be unreached when Settler admission fails first. This does not prove holder compatibility in that rejected case.

Output is allowlisted: no body, complete calldata, provider quote ID, header, cookie, commitment, raw exception or credential-bearing URL. SHA256 source-file fingerprints attest only the listed executing source bytes. Compare each with the reviewed Git blob; they do not attest all transitive dependencies or the public deployment. Runtime hashes remain Ethereum Keccak256. Official source/build provenance must be reconciled with each observed runtime; a remembered registry hash or ABI similarity is insufficient.

## If Vercel production residency is necessary — owner authorization required

Do not run the following deployment as part of implementation/CI. Finish PR review and required exact-head CI first. The available Vercel CLI has no shell execution command inside an existing deployment. Sensitive environment variables must not be pulled into a different machine to avoid this boundary.

The prepared `private-zero-x-proof.vercel.json` is an explicit opt-in, per-deployment build-only configuration. It is not the application's `vercel.json`, not referenced by CI and not loaded by normal builds. It runs the proof with the existing production environment and then intentionally exits 1. Therefore it publishes no successful app/functions. The ERROR build status is expected; the sanitized proof JSON determines the evidence outcome. No public diagnostic surface is created.

After explicit owner approval for exactly one production-context build-only deployment:

1. Fetch main and require the authorized base; require the separately reviewed proof head, green required CI, no unresolved review threads, and a clean isolated checkout. Compare source bytes to Git (account for Windows checkout line-ending conversion; deploy exact Git bytes). Inspect upload inventory with `vercel deploy --dry` and exclude all scratch reports, secrets and local `.env` files. Do not print an environment dump.
2. Read current project/domain binding and confirm Pro, $20 on-demand threshold and production pause remain enabled; no paid add-on or limit change. Record the current public deployment as the preservation/rollback target. Do not infer a hard billing ceiling from the threshold.
3. From the repository root, create only the following unaliased build, substituting the reviewed proof head in metadata:

```sh
vercel deploy . --scope landocrissians-projects --project prj_ko6YOghK5vgJuK2S2MICn1pRNZMD --target production --skip-domain --local-config apps/web/scripts/private-zero-x-proof.vercel.json --meta proofSourceSha=REVIEWED_PROOF_HEAD --yes
```

This includes an explicitly approved per-deployment `ignoreCommand=exit 1` exception. Preserve the project's intentional ignored-build setting and normal tracked application configuration unchanged. Do not promote, merge or re-run automatically.

4. Retrieve only authenticated build logs, extract the single allowlisted proof result, record deployment ID/time/head and compare the seven source-file hashes with reviewed Git blobs. Record production environment usage separately from public application deployment identity. A failed/skipped build with no proof JSON is **blocked access**, not provider incompatibility.
5. Verify the canonical public domain still binds to the recorded existing deployment. No rollback should be necessary because this build cannot become READY and `--skip-domain` prevents promotion. If binding changed unexpectedly, stop for owner review; do not automatically promote the historical rollback candidate.
6. Keep all fees/runtime/security gates unchanged. For an actually quoted unadmitted runtime, return quote-bound block/hash/runtime evidence and the narrow compatibility-review work order. If the reviewed runtime passes, advance to the actual next failing boundary. Do not implement fee settlement in this task.

References: [Vercel per-deployment configuration](https://vercel.com/docs/project-configuration/vercel-json), [sensitive variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables), [0x current price parameters](https://docs.0x.org/api-reference/evm-ap-is/swap/allowanceholder-getprice), [0x contract roles](https://docs.0x.org/docs/core-concepts/contracts).

## Validation

`pnpm exec tsx scripts/private-zero-x-proof.test.ts` exercises the actual adapter/verifier through mocked fetch, three directions, strict fee/chain/runtime negatives, registry pause/reorg, rate limiting, provider/no-route errors, approval/balance/simulation distinctions, configuration fail-closed behavior, output sanitization and subprocess termination. It performs no live provider/wallet action. Included in `test:vnext-adapters`, therefore in required web CI. Run affected authorization, post-approval, wallet/recovery, hardening, release-readiness and typecheck suites unchanged.
