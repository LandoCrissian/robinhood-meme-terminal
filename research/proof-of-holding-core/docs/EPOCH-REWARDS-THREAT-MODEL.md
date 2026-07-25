# PoH Epoch Rewards v0.1 Threat Model

Status: experimental and unaudited

## Assets

- externally funded reward tokens;
- rollover reserves;
- finalized wallet allocations;
- Merkle roots and calculation commitments;
- publisher authority;
- claim replay state.

## Trust boundaries

### On-chain trusted code

- immutable reward-token address;
- immutable review delay and claim period;
- Merkle verification;
- claim bitmap;
- reserve accounting;
- exact-funding checks;
- finalized-root immutability.

### Off-chain trusted process

- source event ingestion;
- excluded-address classification;
- average-balance calculation;
- loyalty-policy execution;
- deterministic integer allocation;
- dataset publication;
- independent root reproduction;
- publisher operational security.

The review delay does not prove root correctness. It only creates time to detect and cancel a bad
pending proposal.

## Threats and controls

### Malicious or compromised publisher proposes an incorrect root

Controls:

- 48-hour review delay;
- public source block range;
- policy, dataset, and calculation commitments;
- immutable root after finalization;
- deterministic public generator requirement;
- production publisher must be a timelocked multisig.

Residual risk: the publisher can still permit an incorrect root to finalize. Bonded competing roots
or a fraud-proof coordinator are future work.

### Publisher drains rewards

Controls:

- no reward-token rescue;
- no generic withdrawal;
- pending cancellation refunds only the original external funding source;
- rollover is restored internally and cannot be withdrawn;
- finalized epochs cannot be cancelled;
- expired allocations become rollover.

### Relayer redirects a claim

Control: the beneficiary is part of the leaf and the transfer always targets that beneficiary.

### Proof replay

Controls:

- chain ID in the leaf;
- distributor address in the leaf;
- epoch ID in the leaf;
- leaf index in the leaf;
- account and amount in the leaf;
- epoch-specific claim bitmap.

### Duplicate index in a malformed dataset

Control: only one leaf at an index can be claimed. The generator and conformance suite must reject
duplicate indices before publication.

Residual risk: a malformed root may make one intended claim unreachable. Root reproduction and
review are required.

### Duplicate account across different indices

On-chain impact: the account may claim each valid indexed allocation, but total claims remain
bounded by epoch funding.

Control: the canonical generator must merge allocations by beneficiary and enforce one leaf per
account per epoch.

### Root allocates more than the funded total

Control: cumulative claims cannot exceed `totalAllocation`, regardless of Merkle validity.

Residual risk: later valid leaves may become unclaimable. The dataset sum must be independently
reproduced before finalization.

### Fee-on-transfer or rebasing reward token

Control: proposal and rollover funding verify the exact contract-balance increase.

Residual risk: negative rebases or nonstandard outbound transfers remain unsupported. V0.1 is
intended for WETH or another exact-transfer ERC-20.

### Reentrancy through reward token

Controls:

- OpenZeppelin `SafeERC20`;
- storage reentrancy guard on proposal, cancellation, funding, and claims;
- checks-effects-interactions ordering;
- immutable reward token.

### Insolvency

Controls:

- explicit global reserve counters;
- post-transition solvency checks;
- exact funding transfers;
- claim ceiling;
- public `accountedBalance()` and `isSolvent()` views;
- invariant tests.

### Unsolicited reward-token transfer

Control: excess is visible as unaccounted balance and can only be synchronized into rollover.
There is no path to the publisher.

### Claim deadline boundary manipulation

Control: claims remain valid at the exact deadline; expiration requires a later timestamp. The
publisher cannot change either timing constant.

Residual risk: L2 timestamp semantics and sequencer delays may slightly alter wall-clock timing.
This does not alter total allocation.

### Gas griefing through batches

Control: batch length is capped at 20. Proof lengths remain caller-controlled, so interfaces should
also set reasonable proof-size limits before submission.

### Denial of service through holder enumeration

Control: no on-chain holder list and no unbounded holder loop exist.

### Publisher role transfer error

Control: two-step nomination and acceptance. Production operations must verify the destination
multisig and timelock before acceptance.

## Security invariants

The implementation and tests must maintain:

```text
rewardTokenBalance >= pendingReserved + finalizedReserved + rolloverBalance
```

```text
0 <= epoch.totalClaimed <= epoch.totalAllocation
```

```text
claimed(epoch, index) changes false -> true at most once
```

```text
finalized root, allocation, commitments, and deadline never change
```

```text
claim transfer recipient == leaf beneficiary
```

```text
cancelled external funding returns only to epoch.funder
```

```text
expired unclaimed value increases rollover and cannot be withdrawn
```

## Launch blockers

- incomplete deterministic root generator;
- root cannot be independently reproduced;
- reward token is not exact-transfer WETH or equivalent;
- publisher is an EOA;
- no event monitoring during the review window;
- no external audit;
- unresolved high or critical findings;
- no fork test against the target chain and reward token;
- no incident procedure for a bad pending root;
- marketing implies guaranteed yield or guaranteed returns.
