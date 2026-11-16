---
name: rmt-control-plane
description: Coordinate bounded RMT engineering tasks without autonomous release authority
---

# RMT Control Plane

Use this skill for authorized work in `LandoCrissian/robinhood-meme-terminal`.

1. Read [AGENTS.md](../../../AGENTS.md), the exact task and the related [architecture](../../../docs/ARCHITECTURE.md), [deployment](../../../docs/DEPLOYMENT.md), [security](../../../docs/SECURITY.md) and [treasury](../../../docs/CREATOR_TREASURIES.md) guidance.
2. Record the exact base SHA and use a separate worktree for changes. Preserve unrelated work and verify package, runtime and deployment dependencies before removing code.
3. Use scoped checks and isolated fixtures. Pin the compiler, chain, deployment and dependencies before relying on replay evidence. Keep historical and new-engine records separate. Missing settlement evidence leaves the transaction pending.
4. Keep credentials out of the worktree, logs and PR. Preserve production, deployed assets, balances, receipts and release gates. Any deployment, signing, live fee change, merge, paid resource, destructive operation or public activation needs separate explicit authorization.
5. Review changed paths and test results at the exact revision. A draft PR can record the change and open findings. Report actionable blockers and preserve `BLOCKED_NO_BROADCAST` while its conditions remain unmet.
