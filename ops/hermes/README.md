# RMT Hermes Development Loop

This directory is the non-secret repository side of RMT's development-agent loop.

It is **not** part of the RMT web app, Token Terminal, NFT Terminal, trading execution, Distribution Center, indexers, contracts, or production infrastructure.

## What V1 does

```text
RMT owner/operator
  -> bounded task contract
  -> Hermes coordinator
  -> rmt-agent-loop.sh
  -> exact-SHA isolated worktree
  -> explicitly selected implementation worker adapter
  -> path guard
  -> independent host validator
  -> fail: bounded retry
  -> pass: READY_FOR_OWNER_REVIEW
```

The runner stops before commit/push/PR/merge/deploy. A later reviewed coordinator step may create a **draft** PR after `READY_FOR_OWNER_REVIEW`; it still may never merge it.

## Coordinator, worker, and validator separation

Hermes is task intake and a future bounded coordinator. `rmt-agent-loop.sh` is
the exact-SHA orchestration and guard layer. A selected worker proposes a
bounded implementation, while the independent host validator is the sole
pass/fail authority.

V1 has one executable worker kind:

- `LOCAL_PATCH`: a loopback-only OpenAI-compatible local model behind the
  patch-only adapter. It receives admitted text context and can propose only
  complete UTF-8 create/replace edits in allowed paths. It has no shell,
  general file, web, GitHub, credential, or production access.

Future stronger worker adapters, including Codex, require a separate
owner-reviewed implementation and canary. V1 ships no Codex executable adapter
and has no automatic worker/provider fallback.

The retained local-model authority classification is only `R0_AND_R1_LOW_RISK`:
documentation, test fixtures, CSS/presentation, deterministic visual-QA or
smoke-test corrections, non-security developer tooling, and other small UTF-8
text changes. It is prohibited from execution, fees, funds, contracts,
credentials, admissions, provenance/security verification, production config,
or deployment.

No provider secret belongs in this repository.

The repository-local Hermes skill lives at
`.agents/skills/rmt-control-plane/SKILL.md`. On an owner-authorized host, trust
this exact repository checkout with `hermes skills trust <RMT_REPOSITORY_ROOT>`;
do not install the skill from a public URL or copy it into another repository.

## One-time host setup (R2)

The initial machine setup changes the development host and therefore requires owner approval.

On the target machine:

1. install/verify Hermes from an owner-reviewed pinned source;
2. install/verify the explicitly authorized local runtime/model;
3. create a separate Hermes profile without cloning credentials;
4. bind the local inference server to `127.0.0.1` only, with no cloud fallback;
5. clone/fetch RMT;
6. ensure the worktree/run roots are isolated from wallet/browser/personal data;
7. run the authority benchmark and validator-gated canary before R1 use.

Do **not** paste API keys, OAuth tokens, `~/.codex/auth.json`, `~/.hermes/.env`, browser-wallet state, SSH keys, or production `.env` files into chat, GitHub, issue bodies, PRs, or the agent worktree.

## Runner

`rmt-agent-loop.sh` requires:

- exact task id;
- exact base ref and SHA;
- a local task contract file;
- an explicit write allowlist;
- an independent host-side validator executable;
- an exact host-controlled worker adapter and worker kind;
- explicit admitted context paths for `LOCAL_PATCH`;
- bounded iteration/time budget.

Example:

```bash
bash ops/hermes/rmt-agent-loop.sh \
  --task-id docs-polish-001 \
  --base-ref main \
  --base-sha <EXACT_SHA> \
  --task-file ~/.rmt-agent/tasks/docs-polish-001.md \
  --validator ~/.rmt-agent/validators/docs-polish-001.sh \
  --worker-adapter /host/rmt/ops/hermes/workers/local-openai-patch-worker.py \
  --worker-kind LOCAL_PATCH \
  --worker-endpoint http://127.0.0.1:18080/v1 \
  --worker-model qwen3-4b-q4-k-m \
  --context docs/TERMINAL_COMPLETION_GATE.md \
  --allow docs/example.md \
  --max-iterations 3 \
  --max-minutes 60
```

The task, validator, and adapter are host-controlled immutable inputs. The
runner pins and rechecks their content identities around each stage. It also
guards HEAD, branch identity, local heads/tags, origin SHA, and the write-path
allowlist. Do not place secrets in any input.

For `LOCAL_PATCH`, context paths must be relative, nonsymlink UTF-8 files in the
disposable worktree. V1 admits at most 8 files and 64 KiB total without silent
truncation. The model response must be one strict JSON object; the adapter
validates the complete edit batch before application. Each replacement is
atomic, and host I/O exceptions trigger rollback of previously applied
replacements and removal of newly created targets. An incomplete rollback is a
hard stop that preserves the worktree for owner inspection.

## Independent validator

The validator runs outside the disposable task worktree and receives:

- `RMT_LOOP_WORKTREE`
- `RMT_LOOP_BASE_REF`
- `RMT_LOOP_BASE_SHA`
- `RMT_LOOP_TASK_ID`
- `RMT_LOOP_ITERATION`
- `RMT_LOOP_TASK_FILE` and its immutable `RMT_LOOP_TASK_HASH`
- `RMT_LOOP_VALIDATOR_FILE` and its immutable `RMT_LOOP_VALIDATOR_HASH`
- `RMT_LOOP_WORKER_FILE`, immutable `RMT_LOOP_WORKER_HASH`, and
  `RMT_LOOP_WORKER_KIND`
- worktree path as its first argument

It returns exit `0` only when the task's acceptance criteria pass.

Example shape:

```bash
#!/usr/bin/env bash
set -euo pipefail
worktree="$1"
cd "$worktree"

git diff --check
pnpm --filter web test:some-focused-lane
pnpm --filter web typecheck
```

A production-grade validator should also enforce the affected repository/domain gates. The validator is a policy boundary, not just a convenience test script.

## Loop stop behavior

Expected outputs:

- `READY_FOR_OWNER_REVIEW`
- `STOP_FOR_OWNER_REVIEW`
- `STOP_SCOPE_VIOLATION`
- `STOP_BUDGET_EXHAUSTED`
- `STOP_VALIDATOR_ERROR`
- `STOP_R2_APPROVAL_REQUIRED`
- `STOP_R3_PROHIBITED`
- `FAILED`

`READY_FOR_OWNER_REVIEW` means the engineering loop passed. It does **not** mean merge or release is authorized.

Worker status is authoritative before validation: `0` may proceed to the host
validator, `10` (`decision=stop`) stops for owner review, and the explicitly
classified transport status `30` may retry only within the existing iteration
and time budgets. Any other nonzero worker status is a non-retryable control-
plane failure. A validator cannot override a stopped or failed worker.

## Main-drift behavior

The runner refreshes the authorized base ref before work and between implementation/validation stages. If the remote base ref no longer equals the task's exact SHA, it stops. It does not silently rebase or decide whether intervening changes overlap.

## Owner-triggered V1

V1 is owner-triggered/manual. The local patch worker is bounded by the runner
and patch protocol. Hermes general terminal access is **not** claimed to be an
adversarial sandbox, and this repository does not enable unattended gateway,
cron, scheduled-task, messaging, or generic autonomous terminal operation.

A future narrowly exposed Hermes coordinator command/tool may invoke the
reviewed runner only after separate owner review.

## First canaries

### R0

Have Hermes read current RMT authority documents at an exact SHA and report:

- active Token/NFT architecture;
- current fee/execution flags;
- prohibited R2/R3 actions;
- no repository mutation.

### R1

Use a deliberately bounded low-risk task admitted for the selected worker.
Passing the local authority benchmark does not make the model production-grade
or generally autonomous.

## Current RMT owner boundaries

This development loop never autonomously authorizes:

- merge;
- deploy;
- production environment mutation;
- RMT fee activation;
- Token or NFT wallet/mainnet execution activation;
- contract deployment/upgrade;
- treasury/Safe/wallet signing;
- Distribution economics;
- project/asset admission where owner authority is required.

See `docs/RMT_AGENT_CONTROL_PLANE.md` for the canonical contract.
