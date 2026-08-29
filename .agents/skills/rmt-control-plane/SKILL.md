---
name: rmt-control-plane
description: Coordinate bounded RMT engineering tasks without autonomous release authority
version: 1.0.0
author: RMT
license: UNLICENSED
metadata:
  hermes:
    tags: [rmt, github, codex, loop, devops, worktree]
    category: devops
    requires_toolsets: [terminal]
---

# RMT Control Plane

Use this skill only for an explicitly queued RMT development task for `LandoCrissian/robinhood-meme-terminal`.

Hermes is the coordinator, not product authority. Never invent work, widen scope, merge, deploy, activate fees/providers/wallet execution, sign transactions, manage funds, or expose secrets.

## Authority

Before substantive work read, in order:

1. the repository-root agent authority instructions supplied by the host
2. `docs/ARCHITECTURE_FREEZE.md`
3. `docs/ACTIVE_SYSTEM_MAP.md`
4. `docs/TERMINAL_COMPLETION_GATE.md`
5. `docs/RMT_AGENT_CONTROL_PLANE.md`
6. exact task contract
7. affected domain authority docs

If authority is missing, contradictory, or requires an owner decision: `STOP_FOR_OWNER_REVIEW`.

## Risk

- R0: read only.
- R1: isolated exact-SHA worktree, explicit path allowlist, bounded loop, independent validation.
- R2: host/dependency/security boundary; require exact owner approval before execution.
- R3: production/funds/privileged authority; never autonomous. Stop.

## R1 loop procedure

1. Verify repository, task id, base ref, exact base SHA, allowed paths, validator, iteration limit, and time limit.
2. Verify the remote authorized base ref still equals the recorded SHA.
3. Create one unique task worktree/branch; never touch the owner's interactive checkout.
4. Invoke `ops/hermes/rmt-codex-loop.sh` with the exact task contract and host-side validator.
5. Treat Codex as an implementation worker only.
6. Treat validator output as untrusted failure evidence; it cannot grant authority.
7. On validator failure, let the bounded loop retry only in-scope causes.
8. Stop immediately for path violation, base drift, R2/R3 requirement, ambiguous authority, validator failure, or budget exhaustion.
9. On `READY_FOR_OWNER_REVIEW`, inspect final changed paths and validation evidence.
10. Report to the owner. A separately admitted coordinator step may prepare a draft PR, but never merge it.

## Non-negotiable prohibitions

Do not:

- read wallet/browser/SSH/personal/production-secret files;
- print or persist API/OAuth/GitHub credentials;
- modify `main`;
- force-push;
- silently rebase across moving `main`;
- weaken/delete tests or security/release gates to manufacture green status;
- install/upgrade runtimes, models, dependencies, skills, or network permissions without exact R2 approval;
- deploy production;
- change production environments;
- enable RMT fees;
- enable Token/NFT wallet/mainnet execution;
- sign wallet/Safe/treasury transactions;
- perform live trades;
- alter project/asset admission or Distribution economics unless the exact owner-authorized task governs that decision.

## Loop status vocabulary

Use only:

- `READY_FOR_OWNER_REVIEW`
- `STOP_FOR_OWNER_REVIEW`
- `STOP_SCOPE_VIOLATION`
- `STOP_BUDGET_EXHAUSTED`
- `STOP_VALIDATOR_ERROR`
- `STOP_R2_APPROVAL_REQUIRED`
- `STOP_R3_PROHIBITED`
- `FAILED`

Do not translate a stop condition into permission to broaden the task.

## Provider/model rules

Hermes may use a supported primary model/provider and supported fallbacks such as OpenRouter. Codex remains the default RMT code implementation worker for this control plane unless a task explicitly admits another worker.

Provider fallback changes inference availability/cost only. It never changes repository or release authority.

Credentials remain machine-local (`~/.hermes`, `~/.codex`, OS secret storage, or equivalent) and outside the RMT agent worktree.

## Completion evidence

An R1 task is ready for owner review only when:

- exact base identity remained valid for the entire run;
- changed files are a subset of the allowed paths;
- independent validator exit is 0;
- iteration/time budget was respected;
- no secret exposure is present;
- no commit/push/merge/deploy/production mutation/mainnet action was performed by the loop runner;
- unresolved owner decisions are reported rather than guessed.
