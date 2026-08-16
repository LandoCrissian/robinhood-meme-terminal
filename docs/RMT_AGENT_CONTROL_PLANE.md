# RMT Agent Control Plane

**Status:** EXPERIMENTAL — DEVELOPMENT OPERATIONS ONLY  
**Effective:** 2026-08-16  
**Initial branch:** `ops/nemohermes-control-plane`

## Decision

RMT will use one human-facing control surface. Background agents are workers, not separate assistants the owner must manage.

The intended control flow is:

```text
owner
  -> one RMT operator / conversation
  -> durable GitHub task record
  -> headless development worker
  -> NVIDIA OpenShell / NemoClaw containment
  -> Hermes coordination
  -> Codex and/or explicitly admitted inference worker
  -> isolated git worktree / task branch
  -> validation
  -> draft pull request or read-only report
  -> one RMT operator / conversation
  -> owner
```

This document defines a development-operations control plane. It does **not** create a second terminal, change VNext, modify execution routing, authorize production automation, or supersede `AGENTS.md`, `ARCHITECTURE_FREEZE.md`, `ACTIVE_SYSTEM_MAP.md`, or provider-specific release gates.

## Why GitHub is the first bridge

The local agent host must not need a public inbound port merely so the human-facing operator can hand it work. The first control-plane transport is therefore a narrow GitHub issue protocol:

1. The operator creates an explicit RMT agent task.
2. A local worker polls only task records that match the control protocol.
3. The worker validates the task contract before doing anything.
4. Read/write development work occurs only in an isolated task branch/worktree.
5. The worker posts status and evidence back to the task and, for code changes, opens a **draft** pull request.
6. The operator reads the durable result and reports through the single human-facing conversation.

A future authenticated direct bridge may replace polling, but it is not required for the first deployment and must not weaken these authority boundaries.

## Task contract

Every executable task must state all of the following:

- a concrete goal;
- risk class;
- base branch and base commit SHA;
- allowed repository paths or an explicit read-only scope;
- prohibited actions;
- required validation commands/evidence;
- acceptance criteria;
- whether network access is required;
- whether a draft PR is expected.

Ambiguous authority fails closed. A worker may narrow its own authority but may not expand it.

## Risk classes

### R0 — observe

Allowed:

- read repository state;
- inspect public documentation and public chain data;
- run non-mutating diagnostics;
- produce analysis and evidence.

Not allowed: repository writes, installs, credential changes, signing, deployment, production mutation, or external communications.

### R1 — isolated development

Allowed only inside a task-specific branch/worktree:

- edit explicitly allowed repository paths;
- run tests, typecheck, builds, security scans, and local simulations;
- create commits on the task branch;
- open or update a **draft** pull request;
- post task status and validation evidence.

Not allowed: merging, pushing to `main`, production configuration, deployment, signing, mainnet execution, treasury actions, data deletion, or expanding provider/fee/automation admission.

### R2 — host or dependency boundary change

Examples include installing or upgrading agent runtimes, changing OpenShell/NemoClaw egress policy, changing host services, adding a new remote integration, changing credential plumbing, or changing a supply-chain pin.

R2 requires a separate explicit human approval for the exact change. Approval for one R2 action does not authorize later R2 actions.

### R3 — production, funds, or privileged authority

R3 is prohibited from autonomous execution by this control plane. It includes:

- production deployment or environment mutation;
- contract deployment or upgrade;
- enabling a provider, fee, autonomous execution path, or production worker;
- Safe/treasury signing;
- wallet seed phrases or private-key use;
- mainnet autonomous trading;
- destructive database or user-data changes;
- branch merge or branch-protection bypass;
- changing an admission/release gate to make an otherwise-ineligible action eligible.

An R3 operation remains a direct owner decision governed by the existing RMT release process.

## Hard security boundaries

### Secrets

The repository, GitHub issues, pull requests, task comments, agent memory, and agent-generated skills must never contain:

- seed phrases;
- private keys;
- Safe signing material;
- production deployment secrets;
- raw provider/API credentials;
- bearer tokens for the Hermes API or dashboard.

Credentials stay in host-side secret storage or the containment/inference gateway and are injected only at runtime. If a secret appears in a task or log, the worker stops, reports a secret-handling incident without reproducing the value, and follows the repository incident-response process.

### Containment

The preferred host runtime is NVIDIA OpenShell managed through NemoClaw, with Hermes as the contained agent runtime. The containment layer is expected to enforce filesystem scope, network egress policy, and routed inference outside the agent process.

The initial policy is default-deny beyond the minimum endpoints needed by the selected task and inference provider. GitHub access, package registries, research domains, chain RPCs, or other egress are admitted deliberately rather than assumed.

The agent workspace is not the owner home directory and must not expose unrelated documents, browser profiles, wallet data, SSH material, or other machine secrets.

### Inference credentials

Prefer host-side routed inference so the sandboxed agent does not receive raw provider credentials. Local inference is an optional execution backend, not an authority expansion.

### Agent memory and generated skills

Hermes may maintain operational memory inside its sandbox. Self-generated skills are untrusted executable/configuration inputs until reviewed. They must not silently become repository authority, modify `AGENTS.md`, change release gates, or gain additional egress/credential access.

Before destructive sandbox work, preserve agent state using the runtime's supported snapshot mechanism. A snapshot is operational recovery data, not source-of-truth architecture.

## Supply-chain policy

Agent infrastructure has broad development-machine capability and therefore uses stricter pinning than ordinary experimentation:

- record exact Hermes and NemoClaw/OpenShell versions used by the host;
- prefer reviewed release artifacts or immutable commit references for unattended installs/upgrades;
- review installer/update provenance before changing the host;
- do not let an agent upgrade itself merely because a newer release exists;
- do not commit downloaded credentials, generated bearer tokens, or mutable runtime state;
- treat experimental inference backends as evaluation-only until separately admitted.

## Git isolation

Every R1 task gets a unique task branch and worktree based on the base SHA recorded in the task. The worker must verify the actual base SHA before writes begin.

The worker may not:

- reuse another active agent's worktree;
- modify the owner's interactive checkout;
- force-push another worker's branch;
- merge its own PR;
- rebase across an architecture change without stopping for review.

If `main` advances during work, the task does not silently absorb the new state. The worker reports the drift and either validates the original base or waits for an updated task contract.

## Validation and evidence

A code-producing task is not complete when code is written. It is complete only when the task's validations run and the result is captured.

At minimum, changes must follow `AGENTS.md` and the affected domain's release lane. Failure is reported as failure; a worker may not weaken tests, security checks, type constraints, recipient verification, provider verification, or release gates merely to obtain green status.

Draft PR descriptions should include:

- task identifier;
- base SHA;
- files changed;
- validations run and exact pass/fail status;
- known limitations;
- security/authority review notes;
- explicit statement that no merge/deploy/production mutation was performed.

## Worker lifecycle

The logical lifecycle is:

```text
QUEUED
  -> CLAIMED
  -> PREFLIGHT
  -> EXECUTING
  -> VALIDATING
  -> REPORT_ONLY | DRAFT_PR
  -> AWAITING_REVIEW
  -> COMPLETE | BLOCKED | FAILED | CANCELLED
```

A worker must be idempotent around claiming and status reporting. Reprocessing a completed task must not repeat writes or create duplicate PRs.

## Initial host target

The first host deployment is a single-user development machine using NVIDIA NemoClaw/OpenShell to contain Hermes. If the host is Windows, NemoClaw runs under WSL2 with the supported Docker Desktop WSL backend. The host setup remains a development/evaluation environment until the platform and our own policy gates demonstrate sufficient stability.

NemoClaw currently documents a first-class Hermes path through `nemohermes`, a local OpenAI-compatible Hermes API, headless deployment, state snapshots, and routed inference. NVIDIA also documents local Ollama and experimental NVIDIA NIM/vLLM options. Experimental local inference does not become the default merely because an NVIDIA GPU is present.

## Rollout gates

### Gate A — repository control protocol

Required before host execution:

- this control-plane contract;
- structured GitHub agent-task template;
- explicit R0/R1/R2/R3 authority model;
- no production activation.

### Gate B — contained host

Required before the first R1 coding task:

- OpenShell/NemoClaw installed from a reviewed source;
- Hermes sandbox created and healthy;
- dashboard/API bound locally unless a separately reviewed access layer is used;
- secret storage verified;
- workspace isolation verified;
- minimal egress policy verified;
- snapshot/recovery test completed.

### Gate C — read-only canary

Run an R0 task that inspects the repository, reads the architecture documents, runs harmless diagnostics, and reports without repository mutation. Verify that prohibited paths and secrets are inaccessible.

### Gate D — isolated development canary

Run a small R1 task in a dedicated worktree. Require focused validation and a draft PR. Verify no write to `main`, no merge, no deployment, and no production mutation.

### Gate E — routine development worker

Only after Gates A-D pass may the worker accept ordinary R0/R1 tasks unattended. R2 still requires exact approval. R3 remains prohibited from autonomous execution.

## Out of scope

This control plane does not authorize:

- an RMT customer-facing AI agent product;
- live trading agents;
- autonomous treasury management;
- autonomous token distribution;
- public Hermes/NemoClaw endpoints;
- replacing VNext or the RMT Agent Engine product architecture;
- production-grade claims about NemoClaw/Hermes.

The RMT Agent Engine product and this development control plane are separate domains even if they reuse some engineering concepts.

## External implementation references

Use current vendor documentation during host setup because agent-runtime behavior changes quickly:

- NVIDIA NemoClaw Hermes quickstart: https://docs.nvidia.com/nemoclaw/latest/get-started/quickstart-hermes.html
- NVIDIA NemoClaw platform/support matrix: https://docs.nvidia.com/nemoclaw/user-guide/hermes/reference/platform-support
- NVIDIA Windows preparation: https://docs.nvidia.com/nemoclaw/latest/get-started/windows-setup.html
- NVIDIA headless Hermes deployment: https://docs.nvidia.com/nemoclaw/latest/user-guide/hermes/deployment/deploy-to-headless-server
- NVIDIA local inference provider matrix: https://docs.nvidia.com/nemoclaw/latest/reference/inference-profiles.html

These are implementation references, not RMT roadmap authority.
