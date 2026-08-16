# Codex Task — Prepare a Verifiable RMT New-Mac Handoff

## Purpose

This task is for the **current Codex session on the source Mac**.

The objective is not to continue product development. The objective is to produce a complete, sanitized, verifiable continuation packet that a **brand-new ChatGPT/Codex session on the destination Mac** can use to establish a fresh RMT work session without relying on hidden state from the source Mac.

The destination Mac will become the sole active RMT development host after acceptance. Do not design a multi-Mac worker topology.

## Authority

Risk class: **R0 / migration audit only**.

Allowed:

- inspect the current local RMT checkout;
- inspect local git branches, worktrees, stashes, remote-tracking state, and unpushed commits;
- inspect non-secret tool/version metadata;
- inspect the current Codex task/session state and summarize it;
- inspect the current GitHub state of the active review boundary;
- generate a sanitized local handoff document;
- run read-only git diagnostics;
- fetch remote refs only if necessary to distinguish local-only work from pushed work, provided doing so does not switch branches or rewrite local state.

Not allowed:

- changing RMT product code;
- committing, pushing, merging, rebasing, resetting, cleaning, stashing, deleting, or force-updating anything merely to make the handoff look clean;
- resolving dirty/unpushed state without explicit owner authorization;
- fixing a failing product/acceptance check during this migration task;
- approving utility rates or making an economic decision;
- modifying production configuration;
- deployment, signing, trading, treasury/wallet access, or provider/fee/automation activation;
- printing, copying, or uploading secret values;
- copying `~/.codex`, browser profiles, wallet files, SSH/GPG private material, production `.env` values, or unrelated home-directory data into the handoff.

If local state is not safely transferable, report **BLOCKED** and explain exactly what must be preserved. Do not auto-fix it.

## Repository authority

Before the audit, read and obey:

1. repository-root `AGENTS.md`;
2. `docs/ARCHITECTURE_FREEZE.md`;
3. `docs/ACTIVE_SYSTEM_MAP.md`;
4. the terminal completion/release gate documents required by `AGENTS.md`;
5. `docs/RMT_AGENT_CONTROL_PLANE.md` from branch `ops/nemohermes-control-plane-v2` if it is not yet merged;
6. `ops/nemohermes/MACOS.md` from that branch.

Do not treat historical roadmap text or chat memory as stronger authority than the current repository.

## Verified active Codex review boundary

The owner has explicitly stated that the current Codex work stopped at the review boundary. GitHub state was independently verified when this handoff contract was updated.

Use the following as the **expected active-work anchor**, then refresh GitHub/remote state read-only before generating the final handoff in case anything changed after this contract was written:

- Draft PR: **#390 — `feat(distribution): add deployment readiness gate`**
- PR state: open, draft, unmerged
- Branch: `codex/rmt-distribution-deployment-readiness`
- Exact head SHA: `c78f50e1c10ce2341241af4fb6833780a9c00e9c`
- Base branch: `main`
- Base SHA: `664db02b5948428ea94a7f5528e8b077f954aafa`
- One commit in PR; seven changed files:
  - `.gitleaks.toml`
  - `apps/web/lib/vnext/distribution-deployment-readiness-smoke.ts`
  - `apps/web/lib/vnext/distribution-deployment-readiness.ts`
  - `apps/web/package.json`
  - `apps/web/scripts/vnext-distribution-deployment-readiness.ts`
  - `docs/RMT_DISTRIBUTION_ENGINE_V1.md`
  - `packages/contracts/script/RehearseRMTDistributionDeploymentV1.s.sol`

The PR's declared safety/readiness boundary is part of the continuation state and must not be weakened during migration:

- utility rates remain structurally `unapproved` / `null`;
- deployer, deployment method, addresses, and transaction identity remain `null`;
- activation, wallet submission, and server submission remain hard-disabled;
- `safeForLiveDeployment: false`;
- `releaseReady: false`;
- `transactionCapability: false`;
- no production utility rates approved;
- no private key or wallet input;
- no broadcast capability;
- no contract deployment;
- no approvals, signatures, transactions, or production-environment mutation.

The PR reports local validation passed, including focused distribution/sink tests, Robinhood mainnet-fork rehearsal, focused Solidity build/formatting, VNext distribution tests, web typecheck/build, terminal release checks, repository checks, production audit, Gitleaks, and `git diff --check`.

### Current GitHub CI state at handoff-contract update

The current PR head has completed these checks successfully:

- Secret scan;
- Terminal visual v2;
- Terminal verification;
- Mainnet readiness;
- CI;
- Smart contract security analysis.

`Terminal high-end acceptance` completed with **failure**. The failing step was the workstation/mobile acceptance check, with the exact reported assertion:

`430x932: backdrop close did not return focus to the Buy action`

The build and type verification inside that workflow passed before the acceptance assertion failed.

Do **not** attempt to fix that failure as part of the migration audit. Preserve it in the final continuation packet. After the destination baseline is accepted, the first engineering action is to refresh PR #390 and its checks at the exact current head, then reproduce/triage that acceptance failure and determine whether it is caused by PR #390, an existing baseline behavior, or a nondeterministic acceptance issue. Do not assume the cause merely because the seven PR files are focused on distribution readiness.

The owner stopped Codex at the review boundary. Therefore:

- do not merge PR #390 during migration;
- do not approve utility rates;
- do not deploy or activate anything;
- do not manufacture a new economic decision;
- preserve the exact review boundary for the destination session.

If PR #390, its head SHA, or CI state changes before the source-Mac audit completes, record both this expected anchor and the newly verified state. Do not silently substitute a different branch/commit.

## Phase 1 — prove the source Mac state

Do **not** switch away from the current branch just to run the migration audit.

Record:

- canonical repository remote;
- current branch and exact HEAD SHA;
- upstream branch, if any;
- current `origin/main` SHA after a safe remote refresh if network access is available;
- full working-tree status;
- all local branches and their upstream/ahead/behind state;
- commits reachable from local branches but not from any configured remote-tracking ref;
- stashes;
- worktrees;
- whether any current Codex-generated work exists only locally;
- whether there are local files that would be lost by doing a fresh clone on the destination Mac.

Use the checked-in sanitized audit helper when available:

`ops/nemohermes/export-source-mac-handoff.sh`

If the current checkout does not contain that file, read it from `ops/nemohermes-control-plane-v2` without switching the owner's checkout. A temporary copy outside the repository is acceptable. Do not execute an unreviewed internet copy.

The helper intentionally does not read secret values. Preserve that property.

## Phase 2 — capture the active Codex continuation state

Start from the verified PR #390 anchor above, then prove the local/session-specific details rather than assuming them.

Produce a concise engineering continuation record for the destination session. It must answer:

- Was the source Mac actually on `codex/rmt-distribution-deployment-readiness` at `c78f50e1c10ce2341241af4fb6833780a9c00e9c` when audited? If not, explain the discrepancy.
- Is the working tree clean, or is there additional uncommitted Codex work beyond PR #390?
- What branch/worktree was the active Codex session using?
- What exact commit was it based on?
- Are the seven PR files the complete pushed change set?
- What validations/tests were already run locally, and what were their exact results?
- What is the latest GitHub CI/check state for PR #390?
- Is the current `Terminal high-end acceptance` failure still present, and what exact failure does the latest run report?
- What remains unfinished at the review boundary?
- Which decisions remain explicitly human-owned, especially utility-rate approval?
- What is the safest next engineering action after the destination baseline is established?

Do not fabricate an answer from chat history. Derive it from the current session, local repository, and GitHub state. If something cannot be proven, label it `UNKNOWN`.

## Phase 3 — inventory machine-local dependencies without leaking secrets

Record versions/availability for the tools actually needed to recreate the RMT development environment, including at minimum:

- macOS version and architecture;
- Xcode Command Line Tools;
- git;
- Node.js;
- pnpm;
- Codex CLI;
- Homebrew if used;
- Docker/Colima if present;
- GitHub CLI if used.

For secret-bearing or machine-local configuration:

- record **path/purpose only** where useful;
- never include values;
- never include seed phrases, private keys, bearer tokens, API keys, cookies, browser-wallet data, Safe/treasury material, or production credentials;
- mark each required secret/config item as `TRANSFER OUT-OF-BAND`, `RECREATE`, or `NOT REQUIRED`.

The destination session must never ask the owner to paste secret values into ChatGPT or GitHub.

## Phase 4 — define the destination-Mac acceptance state

The destination is not accepted merely because the repository cloned successfully.

The handoff must require all of these before the old Mac is retired:

1. destination hardware/architecture identified;
2. fresh clone from the canonical GitHub remote — do not copy the old `.git`, `node_modules`, caches, worktrees, or whole development directory;
3. `origin` verified;
4. exact intended branch/SHA resolved from GitHub;
5. repository authority documents read;
6. clean working tree before new work begins;
7. repo-declared package-manager/runtime requirements respected;
8. dependencies installed from the repository lockfile, not copied from the source Mac;
9. Codex installed/updated through the official supported path and authenticated independently on the destination Mac;
10. `ops/nemohermes/preflight-macos.sh` run once the control-plane branch/files are available locally;
11. required secret/config files recreated or transferred out-of-band without exposing values to chat/GitHub;
12. baseline typecheck/tests/builds appropriate to the active branch run and their exact results captured;
13. PR #390 and its exact current GitHub head/check state revalidated before continuation;
14. no source-Mac-only commits, stash entries, dirty files, or active worktrees remain unaccounted for;
15. destination Codex starts from the verified repository state, not from copied Codex session/auth storage;
16. owner explicitly declares the destination Mac the sole active RMT development host.

Until those conditions are met, the source Mac remains a temporary recovery source and should not be wiped.

## Phase 5 — generate the final handoff packet

Create a **local sanitized Markdown file**, preferably under:

`~/.rmt-agent/handoffs/RMT_NEW_MAC_HANDOFF_<timestamp>.md`

The file must have these sections in this order:

1. `HANDOFF STATUS` — `READY` or `BLOCKED`;
2. `SOURCE MAC PROOF`;
3. `CANONICAL GITHUB STATE`;
4. `ACTIVE CODEX WORK CONTINUATION — PR #390 REVIEW BOUNDARY`;
5. `LOCAL-ONLY STATE THAT MUST NOT BE LOST`;
6. `TOOLCHAIN / MACHINE REQUIREMENTS`;
7. `SECRET/CONFIG MIGRATION — NAMES/PURPOSE ONLY, NO VALUES`;
8. `DESTINATION MAC ACCEPTANCE CHECKLIST`;
9. `EXACT FIRST ENGINEERING TASK AFTER BASELINE`;
10. `NEW CHAT STARTER`.

Do not commit this generated machine-specific report unless the owner separately asks. Review it locally for accidental secret material first.

## Required NEW CHAT STARTER

The final section must be directly copyable into a brand-new ChatGPT chat on the destination Mac. It must contain the following intent, with exact branch/SHA/state values filled from the audit:

```text
RMT NEW-MAC CONTINUATION HANDOFF

You are establishing a brand-new RMT development work session on this Mac.
Do not rely on prior local-machine state or conversation memory. Treat GitHub and the current repository authority documents as source of truth.

Repository:
LandoCrissian/robinhood-meme-terminal

Read the attached/pasted handoff packet completely before changing anything.

Your first responsibility is migration verification, NOT feature development.

1. Verify this Mac's architecture, macOS version, toolchain, and available disk/memory.
2. Establish a FRESH clone from the canonical GitHub remote. Do not copy the old Mac's `.git`, `node_modules`, caches, worktrees, `~/.codex`, or entire project directory.
3. Verify origin, fetch remote refs, and resolve the exact intended branch/SHA stated in this handoff.
4. Read repository-root AGENTS.md and every authority document it requires before substantial work.
5. Compare GitHub state with the source-Mac proof in this handoff. If any expected branch/commit is missing or the handoff says BLOCKED, stop and explain the discrepancy.
6. Install dependencies from repository declarations/lockfiles. Do not reuse copied dependency directories.
7. Install/verify the official Codex client and authenticate independently on this Mac using the supported ChatGPT/OpenAI sign-in flow. Never request that Codex auth files or API credentials be pasted into chat.
8. Recreate required local configuration only through secure/out-of-band transfer. Never request secret values in ChatGPT or GitHub.
9. Run the RMT macOS preflight and the baseline validations required for the active branch. Report exact pass/fail results.
10. Revalidate draft PR #390, branch `codex/rmt-distribution-deployment-readiness`, against the exact source-handoff SHA/check state before continuing it. Do not silently move to another commit.
11. Create a NEW Codex work session rooted in the verified clean repository/worktree. Do not resume by copying old Codex session state.
12. Before feature work, report: machine architecture, repo path, branch, exact HEAD SHA, working-tree cleanliness, Codex version/auth readiness, dependency install result, baseline validation result, latest PR #390 check state, and any remaining migration blocker.
13. Preserve the source review boundary: do not approve utility rates, merge, deploy, mutate production configuration, sign transactions, use wallet/treasury secrets, or enable providers/fees/autonomous execution during migration.

Once every destination acceptance gate passes, declare NEW MAC BASELINE READY. The first engineering task is to refresh/reproduce/triage the outstanding PR #390 review/check state — including the `Terminal high-end acceptance` failure if it still exists — before any decision to modify product code. Do not retire the source Mac until the owner explicitly accepts this baseline.
```

Append the source audit's exact active-work facts immediately after this starter so the new session has the proven continuation state.

## Final response from the source Codex session

When finished, respond with only:

- `HANDOFF READY` or `HANDOFF BLOCKED`;
- path to the generated local handoff file;
- current branch + exact HEAD SHA;
- whether working tree is clean;
- count of local-only commits detected;
- count of stashes detected;
- count of other worktrees detected;
- latest PR #390 head SHA and check summary;
- one-line description of any blocker;
- the complete `NEW CHAT STARTER` from the generated file.

Do not print secret values in the final response.
