# RMT NemoHermes Host

This directory is the checked-in, non-secret source for the RMT development-agent host.

It does not run in the RMT web application, indexers, contracts, production infrastructure, or customer execution path.

## Target

The target is a single-user development host where NVIDIA OpenShell/NemoClaw contains a headless Hermes Agent. Hermes acts as a background coordinator. The human-facing RMT operator remains the only conversational front door.

The first transport between that operator and the local host is the GitHub task protocol defined in `docs/RMT_AGENT_CONTROL_PLANE.md`.

## Runtime layout

```text
GitHub agent task
  -> local task poller / scheduler
  -> NemoClaw-managed OpenShell sandbox
  -> Hermes
  -> RMT control-plane skill
  -> task-scoped worktree
  -> Codex or explicitly selected inference path when needed
  -> validation
  -> read-only report or draft PR
```

The runtime is intentionally outside the product architecture. Do not add a second RMT terminal, route engine, wallet authority, or production agent service to support this host.

## Checked-in assets

- `../../docs/RMT_AGENT_CONTROL_PLANE.md` — authority and lifecycle contract.
- `../../.github/ISSUE_TEMPLATE/rmt-agent-task.yml` — bounded task intake.
- `skills/rmt-control-plane/SKILL.md` — Hermes operating procedure for queued RMT work.

Runtime credentials, bearer tokens, API keys, generated Hermes state, snapshots, model caches, and host-specific secrets do not belong in this directory.

## Host bootstrap boundary

Host bootstrap is an R2 operation because it installs software and changes the local machine/container runtime. It must be performed once with explicit approval on the target machine.

For a Windows host, follow the current NVIDIA NemoClaw Windows preparation rather than inventing a parallel install path. The documented path uses WSL2 plus Docker Desktop's WSL backend and runs NemoClaw commands inside the Linux distribution.

For Linux, use the current NVIDIA NemoClaw prerequisites/quickstart for the exact host architecture.

Do not turn a mutable internet installer into an unattended recurring update mechanism. After the initial reviewed bootstrap, record the installed versions and use an explicit upgrade task for future changes.

## One-time machine touchpoints

The control plane is designed so routine work does not require separate Hermes/Codex conversations. Some machine-local operations cannot safely be delegated through a public chat or repository and remain one-time/operator touchpoints:

1. approve OS-level installation/reboot prompts if the host requires them;
2. complete local provider/GitHub authentication without pasting credentials into chat or GitHub;
3. verify the sandbox can access only the intended RMT workspace and admitted network endpoints.

After those gates, routine R0/R1 work is expected to arrive through the GitHub task bridge and return as durable reports/draft PRs.

## Initial NVIDIA/Hermes onboarding

Use current vendor documentation at execution time. The expected sequence is:

1. validate host prerequisites;
2. install/verify the container runtime;
3. install NemoClaw from the reviewed NVIDIA source;
4. select the Hermes agent path (`nemohermes`);
5. configure an inference provider;
6. create the Hermes sandbox;
7. verify Hermes health and the local OpenAI-compatible API;
8. keep dashboard/API loopback-only unless a separately reviewed access layer is required;
9. snapshot the clean baseline;
10. admit the RMT repository workspace and minimum GitHub egress;
11. install or expose the checked-in `rmt-control-plane` skill;
12. run the read-only canary before enabling any R1 task.

Do not enable experimental local NVIDIA NIM or managed-vLLM paths during the first canary merely because the host has an NVIDIA GPU. Establish the control plane first; benchmark local inference as a separate R2 experiment.

## GitHub credential design

The worker should use a dedicated, least-privilege GitHub identity/credential limited to this repository and the operations the control plane needs. Do not reuse an unrestricted personal credential or store it in the repository.

Required capabilities should be minimized to:

- read queued issues/tasks;
- post bounded task status/evidence;
- fetch repository refs;
- push task branches;
- create/update draft pull requests.

The worker does not need repository administration, Actions secret management, branch-protection administration, environment administration, package deletion, release publishing, or organization administration.

Even if a credential technically permits a dangerous action, `AGENTS.md`, branch protection, the control-plane contract, and the Hermes skill still prohibit merge/deploy/production mutation.

## Network policy

Start from minimum egress. The exact OpenShell policy must be generated/reviewed against the installed NemoClaw version instead of copying an unverified schema into this repository.

At minimum, separate these classes:

- GitHub control/repository traffic;
- selected inference provider traffic;
- package registries only during an approved install/dependency task;
- public research endpoints only for tasks that require them;
- chain RPC/API endpoints only for explicitly scoped read-only research/verification.

Do not grant broad unrestricted internet access as a convenience fallback.

## Workspace policy

The sandbox receives the RMT repository/worktree, not the entire host home directory.

Explicitly exclude unrelated host data, especially:

- wallet files and browser wallet profiles;
- SSH/GPG key directories;
- browser profiles/cookies;
- personal documents;
- cloud credential directories;
- production `.env` files;
- Safe/treasury material;
- other repositories unless a task separately admits them.

## Inference strategy

The control plane does not depend on one model vendor.

Initial preference:

- use the already-admitted hosted model path for high-value coding/reasoning where appropriate;
- keep provider credentials outside ordinary agent-visible files;
- use local inference only after measuring quality, latency, VRAM requirements, tool calling, and failure behavior on the actual host.

NVIDIA NemoClaw documents local Ollama as a supported-with-limitations path and local NVIDIA NIM as experimental. Treat the latter as an evaluation backend until both NVIDIA's status and RMT's own validation justify promotion.

## Canary A — read-only

The first Hermes task must be R0.

Suggested goal:

> Inspect the repository at the exact queued base SHA, read `AGENTS.md`, the architecture freeze, active system map, terminal completion gate, and the agent-control-plane contract. Report the active terminal architecture and list the actions this worker is prohibited from performing. Do not modify the repository or create a branch/PR.

Pass conditions:

- repository remains unchanged;
- no secret paths are accessed;
- no unexpected network egress occurs;
- the report reflects current repository authority rather than historical roadmap files;
- R3 actions are explicitly recognized as prohibited.

## Canary B — isolated development

Only after Canary A passes, queue a deliberately small R1 task. It should touch a non-production documentation/test fixture path, run focused validation, push a task branch, and open a draft PR.

Pass conditions:

- correct base SHA and task identity;
- unique worktree/branch;
- only allowed paths changed;
- validation evidence present;
- PR is draft;
- `main` unchanged;
- no deploy/merge/production mutation.

## Recovery

Before runtime upgrades, policy changes, provider changes, or other destructive sandbox maintenance, create a NemoClaw/Hermes snapshot using the installed runtime's supported snapshot command.

After host restart, do not assume all forwards/services automatically recovered. Use the current NemoClaw status/health checks and restore only the required local forward/services. Headless boot persistence is not an RMT assumption until explicitly tested on the actual host.

## Vendor references

- https://docs.nvidia.com/nemoclaw/latest/get-started/quickstart-hermes.html
- https://docs.nvidia.com/nemoclaw/user-guide/hermes/reference/platform-support
- https://docs.nvidia.com/nemoclaw/latest/get-started/windows-setup.html
- https://docs.nvidia.com/nemoclaw/latest/user-guide/hermes/deployment/deploy-to-headless-server
- https://docs.nvidia.com/nemoclaw/latest/reference/inference-profiles.html
- https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/cron

Always re-check current vendor documentation during an R2 install/upgrade task.
