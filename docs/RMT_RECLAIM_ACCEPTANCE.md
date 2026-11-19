# RMT Reclaim acceptance

[Task 078](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/671#issuecomment-6994244524), stacked on #671 at `8d1876daed6449e40388166255f52f13f3c488dd`. **LOCAL DEVELOPMENT ONLY / BLOCKED_NO_BROADCAST.** This document currently records completed contract checks and the integration boundary. Full browser/PostgreSQL/website/CI results are **pending** and must be added from actual runs before final handoff. Workflow wiring is not test execution.

## Product and custody decision

Reclaim is a bounded token-launchpad companion, not an NFT marketplace or general terminal. A campaign has its own manually funded reward-token reserve and explicitly admitted finite NFT eligibility. It does not draw automatically from creator earnings, Operations, Reserve, LAMMB royalties, project treasuries or LP principal.

| Decision | Implemented boundary | Live approval still required |
| --- | --- | --- |
| Default custody | **Reversible escrow receipt**, with actual ERC-721/1155 safe receipt and immutable claimant/item/quantity/original-reward evidence. | Actual eligible collections, NFT issuer powers and custody policy. |
| Burn/sink/permanent retirement | **Not implemented.** Transfers are not burns. No administrator may transfer or burn accepted NFTs. | Separate policy, authority and reviewed implementation; never implied by this receipt. |
| Returns | Original claimant repays the exact original reward units and receives their own complete receipt's NFTs. Lifetime caps/eligibility remain consumed. | Disclosure of repayment/gas/external-NFT risks. |
| Reward mode | Fixed token units; USD quoting always fails closed. Every NFT acceptance and reward payment is atomic and funded first. | Actual RMT identity, funded balance, fixed-unit campaign approval or a defensible conversion policy. |
| Owner actions | Immediate pause; noticed collection/rate/close/recovery/controller actions, epoch-bound authorizations and incoming-controller acceptance. | Controller/key-continuity responsibility and production activation. |
| Recovery | Only uncommitted reward reserves after close and a fresh notice, paid to the same controller. No arbitrary NFT rescue/drain. | A separately authorized real transaction. |

Unsolicited safe NFT receipts reject. Unsafe forced NFTs, foreign tokens or forced ETH may be stranded and generate no reward. NFT runtime/ERC-165 checks do not universally establish non-upgradeability, authenticity, scarcity or freedom from issuer seizure/burn/blacklisting. Live collection admission requires review of the actual collection authority and precise token-ID/quantity policy. No metadata is treated as eligibility or instructions.

## Units, reserves and anti-abuse

The owner's $20 initial target and $0.05 per eligible unit are **nominal intended equivalents**, not a live price or funded reserve. The isolated model explicitly assumes one synthetic RMT equals $0.01: 2,000 synthetic tokens fund five tokens per accepted NFT unit, for 400 units. It does not create a real RMT token or claim that those token amounts equal dollars in production. A future $0.50-equivalent setting needs funding and separate approval.

The reserve equation is `funded + repaid + unsolicited = reserve + paid + recovered`. Rewards are paid immediately; there are no unsecured credits or accepted-but-unpaid NFTs. Actual token balances are checked independently. Unreconciled gifts are distinguished from manual funding and do not become invented creator earnings.

Each proof binds chain, campaign, collection/runtime, standard, token ID and maximum lifetime quantity. Proofs have at most 32 siblings, a redemption at most eight sorted unique IDs/twenty units. Per-wallet, wallet/collection, collection, token-ID, claimant nonce, policy epoch, exact reward and deadline checks bound acceptance. Returning an NFT does not reset its eligibility or caps. A wallet cap alone cannot defeat Sybil activity; finite owner-reviewed eligibility is essential.

## Source and verification completed so far

All **47 previously tracked Solidity files** match the Task 077 Git blobs and compiler source bytes. Existing curve/v4, token supply, 600M/400M allocation, 90/5/5 entitlements, treasury modules and governance notices remain unchanged. [Frozen-source manifest](evidence/rmt-task078/frozen-source-manifest.json).

The independent three-source Reclaim compiler closure is **`d3596a541f62f25e579e7f8186e017f678a297f454423a4fa9984c898e720471`**, solc 0.8.26/Cancun/viaIR/200 runs/IPFS metadata. Campaign runtime/initcode are **21,278/22,318 bytes**; factory **24,009/46,986**, with **47,050 encoded factory initcode bytes**. Runtime headroom is only **567 bytes**; changed source/constructors require new size verification.

Executed contract checks: **37 Foundry tests passed**, including two 512-run fuzz tests and a 128×32/4,096-call stateful custody/accounting handler. These cover real fixture ERC-721/1155 custody/reward/returns, reserve exhaustion, caps, epoch/nonce/deadline failures, controller/notice lifecycle, unsupported/unsafe receipts, malicious tokens/callbacks and rollback. **Six security-evidence Node tests passed.** These are synthetic local tests, not physical-iPhone acceptance, live financial evidence or an independent audit.

Fresh complete-closure Slither 0.11.5/Crytic Compile 0.3.11 runs **all 101 detectors**: initial **32 findings**, current **28 findings** (**four high, one medium, eighteen low, four informational, one optimization**). The strict Reclaim gate **fails**. Four exact-balance high IDs remain unchanged. Legitimate checks/effects/interactions changes reduced two medium/two low observations while preserving exact delta checks. [Every finding, dataflow, test and uncertainty](RMT_RECLAIM_SECURITY.md); [raw reports and inputs](evidence/rmt-task078/security/).

The earlier **22 core/dependency highs plus six treasury V1 highs** and their failed gates remain visible. The nonspending treasury purchase prototype remains NO-GO. New Reclaim findings do not clear old findings, and no detector or assertion was suppressed.

## Integration acceptance — pending actual execution

The intended entrypoint is the existing isolated harness with `--reclaim-only`; previous default lifecycle, Task 075 profile and Task 076/077 treasury steps remain separate. No production database schema or authoritative writer is rolled out. The existing fixture writer/checkpoint should be exercised against the isolated PostgreSQL schema, with authenticated bounded reads and exact receipt/log/state evidence.

Required before final handoff: actual form→campaign→manual funding→noticed eligibility→ERC-721/1155 surrender→canonical reward/custody→pause/rate/close/recovery; interrupted hash recovery without resubmission; application/indexer restart and reorg rollback; EOA, admitted delegation and genuine 2-of-3 Safe evidence; desktop/portrait/landscape screenshots; public zero-wallet/financial-404 tests. Missing receipt/settlement evidence must remain pending, not synthetic success. **These results are not yet claimed here.**

The new strict security job analyzes every Reclaim production root/reachable import. Local YAML parsing verified the four existing security job objects are unchanged; an additional Reclaim browser step runs for each Chromium/WebKit engine without deleting previous regression stages. Exact-head CI results remain pending.

```sh
pnpm install --frozen-lockfile
(cd packages/contracts && bash scripts/install-v4-deps.sh)
pnpm --filter @rmt/launch-website build
pnpm --filter indexer build
node --test scripts/reclaim/*.test.mjs
forge test --root packages/contracts/reclaim --use /absolute/path/to/solc-0.8.26 -vvv
node scripts/visual-qa/rmt-creator-integration.mjs --reclaim-only \
  --browser chromium --anvil /absolute/path/to/anvil --solc /absolute/path/to/solc-0.8.26 \
  --pg-bin /absolute/path/to/postgresql/bin --output /absolute/unused/output
```

Repeat with WebKit and a distinct unused output. The harness command is integration wiring pending acceptance, not a claim the above sequence has passed. Source/compiler verification uses pinned inputs. New evidence attributes use LF for JSON/MJS/TXT and binary storage for GZ/PNG; artifact inventories must use tracked paths, not ignored local logs or database files.

## Production no-go and owner decisions

No actual new RMT address, approved live campaign/NFT eligibility, funded reward reserve or USD conversion exists. Production pages must say unavailable and make no signing/claim calls. Future activation separately needs accepted RMT identity, explicit fixed-unit/price policy, funding, collection/custody approval, controller responsibility, security disposition, durable indexing/finality and owner deployment/activation authorization. No new wallet or paid service is required for the local implementation.

No production deployment, funded transaction, token issuance, royalty change, automatic treasury purchase, hosting/plan change, production writer/data migration or merge is authorized or performed. LAMMB remains independent. Recommended next task will be narrowed from the actual integration results, not presumed before acceptance.
