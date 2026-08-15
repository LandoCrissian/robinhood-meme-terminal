# Helium RWA release-integrity note — canonical synthetic attestor

**Status:** corrected before deployment  
**Affected surface:** undeployed release-preparation utility only  
**Blockchain transactions:** none  
**Contract changes:** none  
**Synthetic evidence published:** none

## Finding

The first isolated release-preparation implementation used the public fixture key label `0xC4DE` when deriving the synthetic attestor address. The contract tests, synthetic signing utility, rehearsal, and postflight verifier consistently use the canonical public fixture key `0xC0DE`.

No deployment or configuration transaction had occurred, so the mismatch affected only an undeployed transaction-preparation path.

## Correction

The executable entrypoint now pins:

```text
canonical synthetic attestor key: 0xC0DE
legacy transposed fixture label:   0xC4DE
```

Any internal request for the legacy label is redirected to `0xC0DE` before the public synthetic address is derived. The generated release record then checks that its attestor signing address equals the address derived from the canonical key.

The entrypoint also commits the following into every prepared release record:

- SHA-256 of the hardened entrypoint;
- SHA-256 of the pinned implementation module;
- exact Git blob ID of the implementation module;
- SHA-256 of the pinned dependency installer;
- canonical synthetic attestor key label.

Prepared-record verification recomputes those commitments before repeating the source-bound local-fork rehearsal.

## Why the implementation is split

The original implementation blob is preserved byte-for-byte under:

```text
packages/contracts/scripts/_prepare-rmt-commodity-evidence-registry-v0-impl.py
```

The executable reviewed entrypoint is:

```text
packages/contracts/scripts/prepare-rmt-commodity-evidence-registry-v0.py
```

The entrypoint refuses to load the implementation unless its Git blob ID is exactly:

```text
85f9f994c4e8ba85f1acedb198bd2a0faf028925
```

This preserves the already-reviewed no-key implementation while making the fixture-key correction explicit, testable, and tamper-evident.

## CI enforcement

The dedicated commodity-evidence workflow now:

- compiles both Python files;
- executes the entrypoint help path, which verifies and loads the pinned implementation;
- invokes the redirect function and proves that `0xC4DE` resolves to `0xC0DE`;
- confirms that the only `cast send` remains bound to a loopback `local_rpc` Anvil fork;
- rejects key, mnemonic, Foundry broadcast, or remote transaction-submission surfaces;
- validates the undeployed template and all false authorization flags;
- runs the focused Solidity formatting and registry test suites.

## Boundary

This correction does not authorize testnet deployment, configuration, source publication, evidence publication, merge, real inventory, token issuance, RMT-token rights, partner outreach, or any production change.
