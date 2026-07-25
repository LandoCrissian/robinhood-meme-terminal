# Proof of Holding Epoch Rewards Specification v0.1

Status: experimental engineering draft  
Version identifier: `1000` (`0.1.0`)  
Reference implementation: `EpochRewardsDistributor.sol`

## 1. Purpose

PoH Epoch Rewards converts an externally calculated Proof of Holding allocation into a bounded,
fully funded, self-service ERC-20 claim process. It does not calculate wallet loyalty on-chain and
it never loops over the holder set.

The module is intentionally separate from the reference token and PoH Core accounting. A project
can fund rewards without giving the distributor custody of the project token or authority over
wallet balances.

## 2. Non-goals

Version 0.1 does not provide:

- continuous reward-per-weight accounting;
- an on-chain holder enumeration mechanism;
- an on-chain fraud-proof adjudicator;
- automatic ETH push payments;
- cross-chain roots or cross-chain claims;
- transferable claims;
- publisher withdrawals;
- reward-token recovery;
- reward redirection by relayers;
- a promise that a published root is economically fair.

## 3. Roles

### Publisher

The publisher may:

- propose a new monotonically increasing epoch;
- reserve exact external and rollover funding;
- cancel an epoch while it remains pending;
- nominate a replacement publisher through two-step transfer.

The publisher may not:

- finalize an epoch before the review delay;
- edit an existing proposal;
- alter or cancel a finalized epoch;
- withdraw finalized rewards;
- redirect a claim;
- reclaim expired rewards;
- rescue the immutable reward token.

The production publisher is expected to be a timelock-controlled multisig or a purpose-built root
publisher, not a single externally owned account.

### Claim submitter

Any address may submit a valid proof. Payment is always sent to the beneficiary encoded in the
leaf. A relayer cannot replace the beneficiary with itself.

### Epoch finalizer and expirer

Finalization and expiration are permissionless after their respective time conditions become true.

## 4. Immutable timing

The reference implementation fixes:

```text
Review delay: 48 hours
Claim period: 180 days from finalization
Maximum batch size: 20 claims
```

A claim is valid at the exact claim-deadline timestamp. Expiration becomes available only after the
deadline.

## 5. Epoch lifecycle

```text
None
  |
  | proposeEpoch()
  v
Pending ---------------------> Cancelled
  |                              publisher only
  | 48-hour review delay
  | finalizeEpoch() by anyone
  v
Finalized
  | 180-day claim period
  | expireEpoch() by anyone
  v
Expired
```

Finalized and expired roots are immutable.

Epoch identifiers must increase monotonically. A cancelled identifier is consumed and cannot be
reused. Gaps are allowed so an application can align identifiers with an external calendar or
indexer sequence.

## 6. Funding model

Every proposal defines:

```text
totalAllocation = externalFunding + rolloverFunding
```

`externalFunding` is transferred from the publisher during proposal. The distributor verifies the
exact increase in its reward-token balance. Fee-on-transfer, rebasing, or otherwise non-exact
reward assets are outside v0.1 conformance.

`rolloverFunding` comes from the distributor's non-withdrawable rollover balance.

The global accounting invariant is:

```text
accountedBalance = pendingReserved + finalizedReserved + rolloverBalance
rewardToken.balanceOf(distributor) >= accountedBalance
```

State transitions preserve this invariant:

| Transition | Pending | Finalized | Rollover | Token balance |
| --- | ---: | ---: | ---: | ---: |
| External funding | — | — | — | `+externalFunding` |
| Propose | `+allocation` | — | `-rolloverFunding` | unchanged after pull |
| Cancel | `-allocation` | — | `+rolloverFunding` | `-externalFunding` |
| Finalize | `-allocation` | `+allocation` | — | unchanged |
| Claim | — | `-amount` | — | `-amount` |
| Expire | — | `-unclaimed` | `+unclaimed` | unchanged |
| Fund rollover | — | — | `+amount` | `+amount` |
| Sync direct transfer | — | — | `+excess` | unchanged |

Tokens sent directly to the distributor are initially unaccounted. Anyone may irrevocably sync the
excess into rollover. There is intentionally no reward-token rescue function.

## 7. Merkle leaf

The leaf commits to the chain, distributor, epoch, index, beneficiary, and amount:

```solidity
innerHash = keccak256(
    abi.encode(
        LEAF_DOMAIN,
        block.chainid,
        address(distributor),
        epochId,
        index,
        account,
        amount
    )
);

leaf = keccak256(bytes.concat(innerHash));
```

Where:

```text
LEAF_DOMAIN = keccak256("POH_EPOCH_REWARD_LEAF_V1")
```

The outer hash matches OpenZeppelin StandardMerkleTree's double-hashed leaf convention. Internal
nodes use sorted-pair Keccak-256 hashing.

The domain prevents a proof from being replayed across:

- chains;
- distributor deployments;
- epochs;
- leaf indices;
- beneficiaries;
- allocations.

## 8. Claim tracking

Claims use an epoch-specific bitmap:

```text
wordIndex = index / 256
bitIndex  = index % 256
```

The index is part of the Merkle leaf. A claimed index cannot be used again in that epoch.

The dataset generator must enforce:

- one unique index per leaf;
- one canonical allocation per beneficiary per epoch;
- no zero address;
- no zero allocation;
- deterministic sorting before index assignment;
- sum of all leaf amounts equals `totalAllocation`;
- excluded system addresses have zero allocation;
- every numeric value is represented as an integer in base units.

The contract enforces the global allocation ceiling even if a malformed root contains leaves whose
sum is larger than the funded total.

## 9. Epoch commitments

Every proposed epoch stores three nonzero commitments:

### `policyHash`

Identifies the PoH policy and parameter set used to calculate reward weight.

### `datasetHash`

Commits to the canonical allocation dataset, including the leaf index, wallet, amount, and relevant
PoH metrics.

### `calculationHash`

Commits to the deterministic software version and calculation manifest used to produce the dataset.

A recommended manifest contains:

```json
{
  "schema": "poh-epoch-manifest-v0.1",
  "chainId": 4663,
  "distributor": "0x...",
  "epochId": 1,
  "sourceStartBlock": 10000000,
  "sourceEndBlock": 10100000,
  "policyHash": "0x...",
  "datasetHash": "0x...",
  "calculationHash": "0x...",
  "totalAllocation": "100000000000000000000",
  "rewardToken": "0x...",
  "merkleRoot": "0x..."
}
```

The complete dataset and calculation software must be public before the review period ends.

## 10. Review delay and trust model

The 48-hour delay is a review window, not a cryptographic fraud proof. Version 0.1 does not permit
an on-chain challenger to replace or adjudicate a root.

Users therefore trust the publisher not to finalize an incorrect allocation. The following controls
are required before production use:

- deterministic open-source root generation;
- independent root reproduction;
- public dataset publication;
- monitored proposal events;
- a timelocked multisig publisher;
- an operational procedure for cancelling an incorrect pending root;
- a later bonded-proposer or fraud-proof extension if the system becomes material.

## 11. Claims

A single claim contains:

```text
epochId
index
account
amount
proof[]
```

The contract verifies:

1. the epoch is finalized;
2. the claim period remains open;
3. account and amount are nonzero;
4. the index is unclaimed;
5. the Merkle proof matches the finalized root;
6. cumulative claims do not exceed the funded allocation.

State is updated before the ERC-20 transfer. OpenZeppelin `SafeERC20` and a reentrancy guard are
used on transfer-bearing entry points.

## 12. Batch claims

A batch may contain between 1 and 20 independent claims. The bounded loop is over caller-supplied
proofs, never the holder set. One invalid entry reverts the entire batch.

## 13. Rollover

Rollover can receive:

- explicit voluntary funding;
- the rollover portion restored by cancelling a pending epoch;
- unclaimed value from an expired epoch;
- direct transfers synchronized by any caller.

Rollover can only fund a future epoch. The publisher cannot withdraw it.

## 14. Required off-chain outputs

For every epoch, the reference toolchain must publish:

- normalized input checkpoints;
- excluded-address list and version;
- policy parameters;
- wallet average eligible balances;
- wallet age inputs;
- reward weights;
- total weight;
- exact integer allocation and remainder rule;
- leaf indices;
- Merkle proofs;
- dataset hash;
- calculation hash;
- source block range;
- reproducible command and software commit.

## 15. Conformance requirements

An implementation conforms to PoH Epoch Rewards v0.1 only if:

- finalized roots are immutable;
- claims cannot exceed funded allocations;
- proof replay is domain-separated by chain, distributor, epoch, index, account, and amount;
- a relayer cannot redirect payment;
- claim tracking is replay-safe;
- unclaimed expired rewards do not become publisher funds;
- the publisher cannot withdraw reward-token obligations;
- reward-token accounting is externally inspectable;
- all privileged functions and timing constants are disclosed.

## 16. Production exclusions

The v0.1 reference implementation must not be represented as production-ready until it has:

- target-chain fork tests;
- WETH integration tests;
- independent security review;
- static analysis and symbolic review where practical;
- public root-reproduction tooling;
- deployment rehearsal;
- timelock and multisig configuration;
- monitoring and incident-response procedures;
- a public bug bounty.
