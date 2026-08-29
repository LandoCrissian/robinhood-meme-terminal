# RMT Hermes Development Loop

This directory is the non-secret repository side of RMT's development-agent loop.

It is **not** part of the RMT web app, Token Terminal, NFT Terminal, trading execution, Distribution Center, indexers, contracts, or production infrastructure.

## What V1 does

```text
RMT owner/operator
  -> bounded task contract
  -> Hermes coordinator
  -> rmt-codex-loop.sh
  -> exact-SHA isolated worktree
  -> Codex implementation iteration
  -> path guard
  -> independent host validator
  -> fail: bounded retry
  -> pass: READY_FOR_OWNER_REVIEW
```

The runner stops before commit/push/PR/merge/deploy. A later reviewed coordinator step may create a **draft** PR after `READY_FOR_OWNER_REVIEW`; it still may never merge it.

## Why Hermes + Codex + OpenRouter

Hermes is the persistent coordinator. Codex is the primary bounded implementation worker for RMT coding tasks. OpenRouter is optional as a Hermes fallback/auxiliary inference gateway; it is not execution authority and is not required for Codex CLI itself.

Current Hermes supports interactive provider selection through `hermes model`, including OpenAI Codex via ChatGPT/Codex OAuth and OpenRouter. Current Hermes also supports configured fallback providers. Re-check current Hermes documentation during host setup because provider configuration changes faster than RMT repository authority.

No provider secret belongs in this repository.

## One-time host setup (R2)

The initial machine setup changes the development host and therefore requires owner approval.

On the target machine:

1. install/verify Hermes from its reviewed current source;
2. install/verify Codex CLI from its reviewed current source;
3. authenticate Codex/Hermes locally using supported OAuth/provider flows;
4. if OpenRouter is desired, configure its key only in Hermes machine-local secret storage;
5. clone/fetch RMT;
6. ensure the worktree/run roots are isolated from wallet/browser/personal data;
7. run the R0 canary before unattended R1 work.

Do **not** paste API keys, OAuth tokens, `~/.codex/auth.json`, `~/.hermes/.env`, browser-wallet state, SSH keys, or production `.env` files into chat, GitHub, issue bodies, PRs, or the agent worktree.

## Runner

`rmt-codex-loop.sh` requires:

- exact task id;
- exact base ref and SHA;
- a local task contract file;
- an explicit write allowlist;
- an independent host-side validator executable;
- bounded iteration/time budget.

Example:

```bash
bash ops/hermes/rmt-codex-loop.sh \
  --task-id token-polish-001 \
  --base-ref main \
  --base-sha <EXACT_SHA> \
  --task-file ~/.rmt-agent/tasks/token-polish-001.md \
  --validator ~/.rmt-agent/validators/token-polish-001.sh \
  --allow apps/web/app/api/markets/ohlcv/route.ts \
  --allow apps/web/lib/external-ohlcv.ts \
  --allow apps/web/app/vnext/vnext-market-chart.tsx \
  --allow apps/web/app/vnext/vnext-asset-workspace.tsx \
  --allow apps/web/app/vnext/vnext-terminal.css \
  --allow apps/web/lib/server/external-ohlcv-smoke.ts \
  --max-iterations 3 \
  --max-minutes 60
```

The task file and validator above are host-controlled inputs. Do not place secrets in either one.

## Independent validator

The validator runs outside the Codex worktree and receives:

- `RMT_LOOP_WORKTREE`
- `RMT_LOOP_BASE_REF`
- `RMT_LOOP_BASE_SHA`
- `RMT_LOOP_TASK_ID`
- `RMT_LOOP_ITERATION`
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

## Main-drift behavior

The runner refreshes the authorized base ref before work and between implementation/validation stages. If the remote base ref no longer equals the task's exact SHA, it stops. It does not silently rebase or decide whether intervening changes overlap.

## First canaries

### R0

Have Hermes read current RMT authority documents at an exact SHA and report:

- active Token/NFT architecture;
- current fee/execution flags;
- prohibited R2/R3 actions;
- no repository mutation.

### R1

Use a deliberately bounded existing RMT task. The first useful target should be product work already approved by the owner—not agent infrastructure for its own sake.

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
