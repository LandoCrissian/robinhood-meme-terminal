# RMT macOS Agent Host

**Purpose:** keep the Mac clean while giving the RMT control plane a deterministic handoff into Codex and, on supported hardware, a contained NemoClaw/Hermes coordinator.

This is development infrastructure only. It does not run in the RMT product, contracts, production deployment path, wallets, treasury, or live trading stack.

## Recommended topology

Use the Mac as the trusted host and keep responsibilities separated:

```text
single RMT operator / conversation
  -> durable RMT task contract
  -> host-side task broker
  -> exact-SHA git worktree
  -> Codex CLI (`codex exec --ephemeral`)
  -> local validation + scope check
  -> host-side GitHub reporting / draft PR

optional coordination lane on Apple Silicon:
  host-side task broker
  -> NVIDIA NemoClaw / OpenShell sandbox
  -> Hermes
  -> bounded task planning / coordination
  -> host-side Codex handoff
```

The critical separation is deliberate:

- Codex authentication remains on the Mac and is not copied into the Hermes sandbox.
- GitHub write credentials should remain host-side and should not be mounted into Hermes or ordinary Codex worktrees.
- Hermes does not receive the owner's home directory.
- Codex never works in the owner's interactive checkout; every task gets an isolated worktree at an exact base SHA.
- The handoff wrapper does not commit, push, merge, deploy, or mutate production.

This makes Hermes a coordinator rather than a privileged shell over the whole Mac.

## Hardware decision

### Apple Silicon Mac

NVIDIA currently documents macOS Apple Silicon with Docker Desktop or Colima as a NemoClaw path that is **tested with limitations**. This is the preferred Mac target for the combined NemoClaw/Hermes + Codex control plane.

### Intel Mac

NVIDIA currently documents Intel macOS (`x86_64`) as **unsupported** for NemoClaw because the supported OpenShell macOS gateway path is Apple Silicon only.

Codex itself can still run on an Intel Mac. In that case use either:

1. Mac = ChatGPT/Codex host, supported Apple Silicon/Linux machine = NemoClaw/Hermes host; or
2. Mac = Codex-only control-plane worker until a supported NemoClaw host is available.

Do not force-install NemoClaw around NVIDIA's architecture guard.

## Clean host layout

Keep runtime state out of the repository:

```text
<normal RMT checkout>/
  AGENTS.md
  docs/
  apps/
  ops/nemohermes/       # checked-in non-secret control-plane assets only

~/.rmt-agent/
  worktrees/            # disposable task worktrees
  runs/                 # Codex prompts/transcripts/change lists
  tasks/                # optional local task contracts
  snapshots/            # runtime recovery metadata if admitted later

~/.codex/               # Codex-owned auth/config; never mount into Hermes
```

NemoClaw/OpenShell keeps its own managed runtime state. Do not relocate generated bearer tokens, model credentials, or Hermes state into the RMT repository.

## Phase 1 — non-mutating preflight

From the RMT repository:

```bash
bash ops/nemohermes/preflight-macos.sh
```

The preflight installs nothing. It checks:

- macOS architecture;
- Xcode Command Line Tools;
- git;
- Homebrew;
- Docker/Colima reachability;
- Codex CLI;
- existing NemoHermes/OpenShell commands.

Do not continue to NemoClaw installation when the script reports an Intel Mac or a broken container runtime.

## Phase 2 — Codex first

Establish the Codex handoff before adding Hermes. This gives us a working bounded worker even if NemoClaw onboarding is delayed.

Use the official Codex CLI and authenticate locally with the owner's intended ChatGPT/OpenAI account. Authentication material remains in Codex's own host storage.

The repository root already contains `AGENTS.md`; Codex must obey it. The handoff wrapper reinforces the repository authority and adds a task-specific scope.

Example:

```bash
bash ops/nemohermes/codex-handoff.sh \
  --task-id canary-doc-001 \
  --base-sha <exact-40-character-sha> \
  --task-file /tmp/canary-doc-001.md \
  --allow docs/example-canary.md
```

The wrapper:

1. verifies the exact commit exists locally;
2. refuses unsafe task IDs and unsafe allowed paths;
3. refuses to reuse an existing agent branch/worktree;
4. creates `agent/<task-id>` at the exact base SHA under `~/.rmt-agent/worktrees/`;
5. builds a bounded Codex prompt outside the worktree;
6. runs `codex exec --ephemeral` from the isolated worktree;
7. captures the Codex transcript under `~/.rmt-agent/runs/<task-id>/`;
8. compares every changed/untracked file with the admitted path prefixes;
9. fails closed on an out-of-scope change;
10. leaves the worktree for validation.

The wrapper intentionally does **not** commit or push. That is a separate host validation/reporting stage so a model cannot turn a local edit into a GitHub-side action by itself.

## Phase 3 — host validator / GitHub bridge

After the Codex canary works, add the host broker that owns GitHub-side effects.

The broker should:

- read a structured RMT GitHub task;
- verify task ID, risk class, base ref, and exact base SHA;
- materialize a local task contract;
- invoke `codex-handoff.sh` for R1 implementation work;
- independently rerun required validation after Codex exits;
- inspect the final diff and path scope;
- create the commit on the task branch only after validation;
- push only that task branch;
- open/update a **draft** PR;
- post bounded evidence back to the originating issue.

The host broker, not Hermes or Codex, should own the least-privilege GitHub credential. This avoids copying a personal GitHub token into agent sandboxes.

No broker path may merge, deploy, modify production configuration, sign transactions, use wallet/private-key material, or bypass release gates.

## Phase 4 — NemoClaw/Hermes on Apple Silicon

NemoClaw/Hermes is an R2 host change and requires explicit approval at install/upgrade time.

NVIDIA's current macOS prerequisites support Docker Desktop or Colima. The lightweight RMT preference is Colima when it is compatible with the target Mac and existing development workflow, because it keeps the runtime headless and avoids coupling the control plane to a GUI application.

For Homebrew Colima, NVIDIA currently documents both packages as required:

```bash
brew install colima docker
colima start --cpu 4 --memory 8
docker info
```

Those commands are reference commands, not an authorization to run them automatically. Size CPU/memory for the actual Mac rather than blindly keeping the example values.

Then use the current NVIDIA NemoClaw Hermes quickstart. NVIDIA currently documents:

```bash
export NEMOCLAW_AGENT=hermes
export NEMOCLAW_SANDBOX_NAME=rmt-hermes
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
```

Review the current installer and vendor documentation at execution time. Do not turn the hosted installer into an unattended self-update path.

For the first onboarding:

- skip optional messaging/web-search channels;
- keep dashboard/API local-only;
- use the minimum network policy;
- do not mount the owner's home directory;
- do not copy `~/.codex`, browser wallets, SSH/GPG keys, production `.env` files, or GitHub admin credentials into the sandbox;
- run the R0 read-only canary before allowing any R1 task.

NVIDIA currently exposes the Hermes dashboard locally and a separate OpenAI-compatible API (default local API port documented as 8642). Keep both loopback-only for the first deployment.

## Why Codex stays host-side initially

It is technically possible to install more tooling inside the Hermes container, but the clean first architecture keeps Codex on the Mac:

1. Codex can use its normal macOS authentication and sandbox behavior.
2. We do not need to copy Codex authentication into Hermes.
3. Codex gets an exact task worktree rather than broad host filesystem access.
4. Hermes can coordinate without becoming the credential owner for every downstream tool.
5. The host broker can inspect the diff before any GitHub write occurs.

If later testing demonstrates a stronger contained Codex-in-OpenShell design, that can be proposed as a separate R2 change rather than assumed now.

## Smooth handoff contract

The long-term owner experience should be one instruction at the RMT front door. Internally the broker translates it into a durable task containing:

- task ID;
- exact base ref and SHA;
- R0/R1/R2 risk class;
- allowed read/write paths;
- prohibited actions;
- network class;
- validation commands;
- acceptance criteria;
- expected output (report or draft PR).

For an R1 coding task the sequence is:

```text
operator creates task
  -> broker claims task
  -> broker creates exact-SHA worktree
  -> Hermes may refine/check the bounded execution plan
  -> broker invokes Codex non-interactively
  -> Codex edits/tests locally
  -> broker verifies scope and reruns validation
  -> broker commits/pushes task branch
  -> broker opens draft PR
  -> result returns to the operator
```

Codex receives all context in the task prompt and the repository's `AGENTS.md`; it does not need the owner to restate prior conversation context manually.

## First two canaries

### Canary 1 — Codex handoff only

Use `codex-handoff.sh` on a tiny documentation-only task with one allowed file. Confirm:

- exact-SHA worktree created;
- owner checkout untouched;
- Codex reads `AGENTS.md`;
- only admitted path changes;
- transcript captured;
- no commit/push/deploy occurs.

### Canary 2 — Hermes read-only

After NemoClaw onboarding, run the control-plane R0 canary from `README.md`. Confirm:

- sandbox cannot read unrelated host/private paths;
- expected network restrictions hold;
- Hermes correctly reports repository authority and R3 prohibitions;
- repository remains unchanged.

Only after both canaries pass should we wire automatic R1 task polling.

## Vendor references

Current implementation references must be rechecked at install/upgrade time:

- NVIDIA NemoClaw Hermes quickstart: https://docs.nvidia.com/nemoclaw/latest/get-started/quickstart-hermes.html
- NVIDIA NemoClaw macOS prerequisites/platform matrix: https://docs.nvidia.com/nemoclaw/user-guide/hermes/get-started/prerequisites
- NVIDIA NemoClaw platform support: https://docs.nvidia.com/nemoclaw/user-guide/hermes/reference/platform-support
- OpenAI Codex CLI repository: https://github.com/openai/codex
- OpenAI Codex CLI getting started: https://help.openai.com/en/articles/11096431

These references describe host tooling only. RMT repository authority remains defined by the checked-in project documents.
