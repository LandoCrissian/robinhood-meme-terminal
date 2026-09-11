# Trade contract compatibility and state coherence

Base: `b88d8e5886bad08c04166e86640e48e10100d242`.
Scope: `RMT_LIVE_TRADE_CONTRACT_COMPATIBILITY_AND_STATE_COHERENCE_V1`.
This is a repair/review record, not Production trading stabilization proof.

## Original incident

ORIGINAL_INCIDENT_CAPTURE: UNAVAILABLE.

The original failed quote/verify payload, client generation, exact input/output
identity failure, decoded execution targets, and restored banner's journal
association are unproven. The reported supporting diagnostic file does not
establish those associations. A successful historical transaction cannot identify
the banner by itself. Rabby ending 0387 and MetaMask ending 76cA are different
wallet contexts; this repair does not attribute one to the other.

## Demonstrated failure and repair

The original client mapped an unphased HTTP 422 verification rejection to
`QUOTE_SERVICE_UNAVAILABLE` / network. The HTTP retry helper did not retry 422;
higher-level approval recovery could retry the misclassified phase. Typed
failures now carry stage, code, retryability and sanitized detail through verify,
authorize and clients. Unchanged runtime-policy rejection is non-transient.
Transport retries and application retries have separate regression assertions.

Primary economics use current intent-bound verification and authorization
evidence. Before that evidence, output is an estimate and no protected minimum
is established. Comparison cards remain explicitly non-executable. The cache
key includes preparation context rather than only the narrower quote request.
Current evidence checks wallet, recipient, chain, assets, amount, provider,
verification/request binding, expiry and protected minimum.

Restored verified swaps are labeled historical with their actual transaction
and available submission time, not an invented confirmation time. Historical
confirmed records cannot produce the current attempt's success receipt.
Unresolved and approval records remain available to recovery; the journal is
not cleared to hide history.

## Runtime decision

Two independent gates apply: official deployment eligibility and reviewed
runtime/decoder compatibility. A current lookup failure must not fall through
to previous deployment acceptance. Registry and runtime reads use the selected
block. Authorization rechecks eligibility and bytecode against committed
evidence. Outer AllowanceHolder and inner decoded Settler remain distinct.

Read-only registry observation at block `0x392ae8c`:

- Chain: 4663.
- Block hash: `0x759d65d91f9aade2a312a564f7fce5fb89fa6ce326228d582448bc9705f7bfe7`.
- Timestamp: `2026-09-11T03:39:10.000Z`.
- Registry: `0x00000000000004533Fe15556B1E086BB1A72cEae`.
- Current: `0x6aa80dbbed9ae5ab45fbf61f9644fada3b29326e`.
- Current runtime: `0xa1a2a85048dd0f8cccc5f2012ff175b88d928c87c84e66691357842ec34e572f`.
- Previous: `0x39b38686a19836ac10162c490e4558e120cbbe5f`.
- Previous runtime: `0xb6c0bf3b83bc9ae4f6ed65a4f5f6c188eb3e4258d8d3b3705dff4ac02ed4a966`.

This observation is not an execution payload and does not identify the original
failed quote's target. The existing reviewed runtime remains pinned to official
commit `95184a23336b52d99aaa528c5b1259e3bb04eafe` and its existing final
post-action/post-fee minimum decoder review. The newly observed current runtime
is NOT admitted. Its source/runtime provenance and semantic compatibility review
remain unresolved. ABI similarity and registry membership alone are insufficient.

References: https://docs.0x.org/docs/core-concepts/contracts and
https://github.com/0xProject/0x-settler#how-do-i-find-the-most-recent-deployment.

## Identity boundary

Controlled cold tests distinguish durable provenance from missing records,
transport failure, rejected provenance, live failure and positive conflict.
Native ETH is local. Trusted durable PEEP survives metadata unavailability;
unknown/rejected identity does not. Directory visibility is not identity proof.
No retrieval/persistence defect was demonstrated, so no speculative identity
fallback or identity-policy change is included.

## Evidence classification and validation

`test:trade-contract-coherence` covers registry/current/previous/paused controls,
typed failures, separate HTTP/application retries, economics bindings and cold
identity boundaries. `test:execution-hot-path` covers existing identity and wallet
connection controls. Browser scenarios use owned Next routes with external
provider/RPC fixtures and mocked wallet dispatch, never real wallet requests.
Browser assertions compare displayed output/minimum to the applicable verified
evidence and authorization plan. A quotes-only test is not full-path acceptance.

Validation outcomes and exact head belong in the PR and CI results; this file
does not predeclare unrun scenarios as passing. Mock native settlement does not
prove current Production trace-provider capability. No original authenticated
incident payload or live trace proof has been recovered by these tests.

## Preserved controls

Zero-x-only public execution, 25 bps exact-sell-token fee and rounding, narrow
approvals, no Settler approval, Stock exclusion, project quarantine, simulation,
authorization bindings and strict output settlement remain required. No merge,
deployment, Production configuration change, credential export, real wallet
request, signature, approval or transaction is performed by this repair.
Monitoring PR #520 and its worktree are outside this change.
