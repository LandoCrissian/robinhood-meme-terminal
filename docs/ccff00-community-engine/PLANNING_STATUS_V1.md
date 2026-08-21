# CCFF00 Community Engine planning status V1

**Status:** PLANNING SPECIFICATION COMPLETE ENOUGH FOR SEQUENTIAL CODEX IMPLEMENTATION — RUNTIME STILL NOT AUTHORIZED  
**Planning branch:** `planning/ccff00-community-engine-v1`  
**Original branch base:** `a7aab30fc72f7fc2b6acc23eeb71b4a5e32ddc78`

This status file records the planning branch's intended isolation and the remaining evidence-driven decisions. It is not a merge request or runtime-release declaration.

## 1. Isolation audit

At the latest planning audit in this session:

```text
current main: 910b5ae9492cca1376c21b42e39b03409957d2d2
planning merge base: a7aab30fc72f7fc2b6acc23eeb71b4a5e32ddc78
planning branch: ahead of merge base, behind current main by 1 commit
```

The compare shows **only added files under**:

```text
docs/ccff00-community-engine/
```

No runtime/app/contract/env/CI/source file has been modified by this planning track.

Do not rebase/merge active main work into the planning branch merely to make it current. Future implementation reads these specs and branches from latest `main`.

## 2. Planning coverage

The specification set now covers:

```text
owner/seat identity
original mint provenance
canonical CCFF00/TBA reuse
candidate discovery
WATCH PROJECT behavior
quality/curation policy
positive mint adapters
runtime/proxy evidence
zero-price enforcement
fairness quantity cap
historical acquisition-block census
verified public randomness
unbiased shuffling
NFT-to-seat pairing
least-served Square selection
pre-delivery owner refresh
partial delivery/repair
collector signer isolation
submission ambiguity
single-writer runtime
START/STOP semantics
reorg/restart handling
community ETH gas funding
public transparency proofs
RMT Pay dead-address economics
RMT Pay wallet/AA compatibility
RMT Pay atomicity/no-sell policy
stable error taxonomy
A–K implementation packets
machine-readable package dependencies
upstream reuse/rejection decisions
```

## 3. Locked owner/product decisions

Authoritative list remains `DECISION_REGISTER_V1.md`.

Key locked rules:

```text
one current owner address = one seat
multiple Squares = no extra seat odds
current ownership beats original mint history
no inferred same-human wallet clustering
public CCFF00 range only
ETH donations = no allocation weight
least-served-first
one mint run = one floor-bounded allocation batch
acquisition block anchors allocation census
randomness round derived mechanically from fixed policy
no NFT price/rarity/hype weighting
no post-acquisition cherry-picking
known mint adapters only
native mint value exactly zero
one collector, no burner-wallet limit evasion
operator controls START / STOP / WATCH PROJECT
collector isolated from privileged/user wallets
RMT Pay → 0x...dEaD
no automatic RMT→ETH sale
native gas funding separate from RMT burn
no RMT redeploy merely for burn()/permit()
```

## 4. Deliberately unresolved evidence-driven decisions

These should **not** be guessed during planning.

### Package A

```text
exact live publicMinted
exact unique current owner seats
exact 1/2/3/4/5+ current ownership distribution
exact maximum Squares per current owner
```

### Package B

```text
exact collection deployment/start boundary
exact unique original recipients
exact original multi-mint distribution
```

### Package C/D

```text
live OpenSea Robinhood Drops capability
actual currently used Robinhood mint families
actual Robinhood SeaDrop/runtime identity if any
first positive mint adapter
quality threshold calibrated on real candidates
```

### Package E

```text
final production randomnessLeadSeconds
implementation-time drand Quicknet identity revalidation
exact canonical binary encoding/domain constants
```

### Package F

```text
safeTransferFrom receiver compatibility of exact CCFF00 TBA
whether ordinary transferFrom fallback is required
```

### Package G/H

```text
collector signer technology
numeric mint/gas/day/inventory caps
future execution service directory/runtime/storage
leader/lease implementation if multi-replica
```

### Package I

```text
whether an onchain gas vault is needed at all
vault collector rotation/governance/refill design
numeric refill/epoch caps
```

### Package J/K

```text
which current external-wallet paths can safely support RMT Pay
which AA/sponsorship provider works with exact connector/TBA semantics
whether same-address EIP-7702 composition succeeds
which utilities become payable in RMT
exact RMT utility prices
exact sponsored-gas budgets
whether a utility burner/router contract is necessary
```

A `NOT_CURRENTLY_SAFE` outcome for RMT Pay is acceptable and does not reopen the RMT redeployment decision.

## 5. External dependencies already evaluated

See `UPSTREAM_REUSE_V1.md`.

Planning disposition:

```text
viem                      REUSE current stack
CCFF00 ERC-6551 evidence  REUSE current RMT integration
OpenSea Drops             adapter candidate; live probe later
SeaDrop                    adapter/reference; exact Robinhood runtime must be proven
drand Quicknet             first randomness candidate; revalidate/verify cryptographically
Robinhood Blockscout       enrichment/public evidence, not signing authority
Alchemy                    AA/sponsorship candidate, not RMT burn-settlement authority
Reservoir hosted API       not a Robinhood V1 dependency today
Mint.fun bot               architecture prior art only
thirdweb Engine Core       future Package H operational reference only
new generic indexer        rejected for A/B
browser mint automation    rejected
```

## 6. Future implementation entrypoints

Human/Codex should begin with:

```text
CODEX_HANDOFF_FINAL_V1.md
CODEX_START_HERE_V1.md
CODEX_PACKAGE_MANIFEST_V1.json
```

Then read only the package-specific files listed there.

Do not begin with every long document in one context window unless a cross-domain review actually needs them.

## 7. First future implementation package

Package A only:

```text
read-only CCFF00 Community Census
```

Expected likely files are specified in:

```text
PACKAGE_A_B_IMPLEMENTATION_V1.md
INTEGRATION_MAP_V1.md
REFERENCE_INTERFACES_V1.md
```

Package A must not add provenance, provider discovery, signer, worker, database, API/UI, gas vault or RMT Pay.

## 8. What this planning branch intentionally does not contain

```text
production TypeScript implementation
new Solidity contract
signing/private key code
API credentials
environment changes
scheduled worker
Firebase/Postgres schema
public UI
mainnet/testnet transaction
contract deployment
terminal fee/revenue policy mutation
PR merge authorization
```

## 9. Merge posture

Do **not** merge this entire planning branch into `main` merely because the documentation is comprehensive.

Preferred implementation workflow:

1. keep planning branch as reference;
2. Package A Codex branch starts from latest main;
3. implement only Package A;
4. copy/update only documentation materially required by that package/current architecture;
5. review/merge Package A independently;
6. repeat for B, C, etc.

This avoids dropping a large planning-document tranche into the production branch and prevents stale branch history from colliding with current Codex work.

## 10. Planning completion standard

Planning is considered sufficient for a clean handoff when Codex no longer has to invent answers to these questions:

- who is entitled?;
- how are multiple Squares treated?;
- how are donors treated?;
- what holder snapshot is used?;
- what is a free mint?;
- how is an NFT contract admitted?;
- how is quantity capped?;
- what randomness is acceptable?;
- how are NFTs paired?;
- what if a Square is sold?;
- what if a transaction times out?;
- what can the operator control?;
- what can the collector signer access?;
- where does gas come from?;
- where does spent RMT go?;
- does RMT need redeployment?;
- what must be proven before production?

Those questions are now answered by the specification set. Remaining unknowns are intentionally empirical/package-specific.
