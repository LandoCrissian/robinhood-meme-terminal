# Task 088 B: bounded core/dependency defensive reproduction

**Reproduced: 233 findings, 22 High; 112 local tests passed. The strict gate remains FAIL_HIGH / BLOCKED_NO_BROADCAST.**
This separate workstream starts from website PR #682 source
`b02a0c2bb3b2814bfc9a0610dee79860b648cc08`. It changes evidence only.
It does not clear findings, change contracts/economics/immutables, weaken an
assertion, suppress a detector, or authorize deployment or financial activity.

## Exact scanner reproduction

Slither 0.11.5 and Crytic Compile 0.3.11 ran the unchanged
`docs/evidence/rmt-task043/analyze-rotation.py` with all **101 detectors**.
The complete 66-source Standard JSON digest is
`66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`.
Every original first-party source, transformed review source and dependency
hash matches the retained compiler manifest.

The fresh result contains **233 findings: 22 High, 60 Medium, 39 Low,
110 Informational and two Optimization**. All 233 finding IDs match the
retained report, including all 22 High IDs. The analyzer returned **exit 1**;
the raw output and failing result are retained. Seven previously discussed
governance Medium observations remain within that unchanged result.

The ephemeral host is ARM64. The reviewed compiler helper's platform table has
no linux-arm64 entry; that table and its assertions were preserved.
`reconstruct-input.py` independently reconstructs the exact input from checked
source bytes and committed transformations, and rejects any source or complete
input digest mismatch. The exact pinned Linux x64 Solidity compiler
`0.8.26+commit.8a97fa7a` ran through a transparent QEMU execution wrapper.
Its executable digest is
`d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef`.
The raw analyzer records the wrapper digest; the manifest separately records
the actual compiler digest and complete wrapper command. This is emulated
execution of the same compiler bytes, not a new compiler profile.

## Source interpretation and remaining limits

[finding-matrix.json](finding-matrix.json) contains one row for every High ID:
exact source/function/call or expression, exposed accounting decision, necessary
counterfactual, existing guards, corresponding local tests and residual limits.
Its historical `PINNED_FALSE_POSITIVE` values are explicitly marked as prior
internal metadata. The new disposition for every row is
`REPRODUCED_HIGH_STRICT_GATE_UNCLEARED`.

- **Eight funding observations** concern engine/shared-manager snapshots across
  token pull, token approval, Permit2 approval and PositionManager funding.
  The source retains guarded entry, fixed token/dependency bindings, checked
  finite approvals and expiry, complete consumption, exact asset deltas and
  original-position custody checks. Callback injection, incorrect settlement,
  pool perturbation, nested unlock and rollback tests challenge these guards.
- **Three curve-graduation observations** concern token snapshots across grant,
  engine settlement and revoke. The curve seals trading and clears recorded
  backing before interactions, authenticates refunds and checks both assets
  and allowance clearance after settlement.
- **One LP-harvest observation** concerns the ledger snapshot around the fixed
  zero-liquidity action sequence. The immutable destination, original position,
  fee growth, unchanged liquidity and exact ledger credits are checked.
  Removal or weakening of those checks would remove an existing protection.
- **Six migration observations** concern predecessor/successor snapshots across
  transfer, original-ledger writer handoff and successor acceptance. The
  predecessor closes first; the successor stays inactive through the call-free
  ledger handoff; exact asset, writer and successor-state checks follow.
  Factory/registry route barriers and atomic rollback remain required.
- **Four dependency observations** concern two deliberate modular-inverse XOR
  seeds and two deliberate packed Yul shift lookups. The independent wide-product
  quotient/remainder and simple bit-scan oracles support the intended arithmetic
  at these exact source pins. Replacing XOR with exponentiation or obscuring the
  expressions merely to silence analysis is not a defensible repair.

No new confirmed defect was established in the inspected exact paths.
No contract patch is proposed from this finite reproduction. A runtime pin
establishes identity, not correctness of an arbitrary future admitted template.
Changed tokens, hooks, subscribers, action encodings, dependencies and raw
proposal/migrationNonce consumers require separate review. Source and local
tests do not freshly verify deployed identities, current chain state, external
implementation correctness, L1 finality or permissionless-publication status.

## Local synthetic verification

The full existing Foundry run passed **112 tests across 14 suites, zero failures
and zero skips**, with 512 runs per existing fuzz case. The 170-file pinned
compiler build completed in 986.55 seconds through QEMU; test execution took
1.79 seconds. Original test warnings remain in [foundry.log](foundry.log).

The command is `forge test --use <pinned-compiler-wrapper> --offline -vv`,
with native Foundry **1.7.1** (the ARM64 archive digest was checked against the
official release asset digest). Existing test source was inspected for fork,
RPC, FFI and broadcast calls; none is used by this suite. The test VM uses
synthetic assets/accounts and chain 31337. Existing tests generate VM-only signatures and execute only local test governance contracts. No wallet, third-party account,
live fork or vulnerability testing against a live chain is involved.

The full local suite compiles the unchanged repository test profile. Its untransformed local curve constants are 1 ETH graduation backing and 2 ETH virtual ETH; the retained 4663 profile uses 2 ETH backing and 4 ETH virtual ETH; the exact 4663 profile is reproduced by the scanner input,
not claimed as a newly executed production lifecycle. Existing source-binding
evidence tests also passed **two tests, zero failures/skips**, reading retained
files offline; they do not repeat the historical live/fork observations.

## Reproduction and evidence

On a reviewed x64 host, the existing compiler helper remains the normal route
to produce/verify the exact Standard JSON. On ARM64, this package's independent
reconstructor requires the installed pinned dependency files and writes only
to a fresh output path:

```sh
python3 docs/evidence/rmt-task088b/security/reconstruct-input.py /tmp/fresh-4663.json
python docs/evidence/rmt-task043/analyze-rotation.py /tmp/fresh-4663.json <solc> /tmp/fresh-source /tmp/fresh-scan.json
# Expected analyzer exit: 1; retain the report.
cd packages/contracts
forge test --use <solc> --offline -vv
```

The first setup attempts and their exact errors, interpreter/tool versions,
actual compiler versus wrapper identity and evidence digests are retained in
[reproduction-manifest.json](reproduction-manifest.json). No safety or
authorization restriction was bypassed. Setup failures concerned a wrong
working directory absent x64 runtime libraries and a Python archive API incompatibility; all were corrected in the
isolated environment.

The offline evidence verifier passed. The final unchanged-rule Gitleaks 8.30.1 scan of this new evidence directory returned raw exit 0 and zero matches; this is not a full-history clean-scan claim. Re-run the source/evidence checks with `python3 docs/evidence/rmt-task088b/security/verify-evidence.py`.

Production, deployed sources, runtime pins, scanner policies, security holds
and optional-module findings are unchanged. This evidence branch remains
separate from website work and is not published before parent review.
