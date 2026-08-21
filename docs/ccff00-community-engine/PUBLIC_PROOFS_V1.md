# CCFF00 Community Engine public proofs and transparency V1

**Status:** PLANNING ONLY — FUTURE PUBLIC-EVIDENCE DESIGN

The Community Engine is meant to be community infrastructure. Fairness claims should be independently checkable from public evidence, not dependent on “trust the RMT operator.”

This document defines what future public proof packets should expose without turning the operator UI into a data dump or making soft quality judgments look like guarantees.

## 1. Transparency goals

A holder should eventually be able to answer:

1. How many current CCFF00 owner seats were eligible for this mint run?
2. Why did the engine mint this project at all?
3. Did the mint itself cost zero native ETH other than gas?
4. How many NFTs did the collector actually acquire?
5. Was the complete acquired inventory committed before randomness was known?
6. Which exact CCFF00 ownership snapshot was used?
7. Which randomness network/round was used, and was it predetermined?
8. Can I reproduce the randomized seat/token pairing?
9. Why did a particular Square receive the NFT?
10. Did ETH donors receive any extra allocation weight?
11. How much community ETH has been contributed/spent on collector gas?
12. If RMT Pay is later used, how much RMT was sent to the dead address through protocol utility versus simply being at the dead address for unrelated reasons?

## 2. Public evidence principles

- onchain facts link to exact transaction/block/contract identity;
- deterministic offchain artifacts expose canonical hashes;
- provider soft evidence is labeled as provider/observer evidence;
- quality score is explainable but never called a guarantee;
- no donor leaderboard is necessary for fairness;
- no operator-only randomness seed exists;
- failed/rejected candidates can expose sanitized reason codes;
- secrets/provider credentials never appear in proof packets.

## 3. Public census summary

Future status may expose:

```text
snapshot block
snapshot block hash
public Squares minted
unique current owner seats
owners with 1 Square
owners with 2
owners with 3
owners with 4
owners with 5+
max Squares in one owner wallet
activated canonical TBAs
census hash
```

The full deterministic census artifact may be downloadable/reproducible later if desired. Because current ownership is already public blockchain data, this is not secret, but the primary UI should not unnecessarily profile holder wallets.

Prefer public fairness display by:

- seat counts;
- CCFF00 token IDs/Squares;
- proof hashes;

rather than a ranked list of owner EOAs.

## 4. Public mint-run proof packet

Reference public shape:

```ts
type CommunityMintRunPublicProofV1 = {
  schemaVersion: 1;
  chainId: 4663;
  mintRunId: Hex;

  project: {
    collection: Address;
    mintTarget: Address;
    adapterId: string;
    adapterVersion: number;
  };

  acquisition: {
    transactionHash: Hex;
    blockNumber: UintString;
    blockHash: Hex;
    nativeMintValueAtomic: "0";
    gasUsed: UintString;
    effectiveGasPriceAtomic: UintString;
    acquiredQuantity: number;
  };

  evidence: {
    mintPlanHash: Hex;
    runtimeEvidenceHash: Hex;
    qualityEvidenceHash: Hex;
    inventoryHash: Hex;
  };

  fairness: {
    censusHash: Hex;
    fairnessPolicyHash: Hex;
    randomnessPolicyHash: Hex;
    allocationResultHash: Hex;
  };

  randomness: {
    sourceId: string;
    chainHash: Hex;
    round: UintString;
    randomness: Hex;
    recordHash: Hex;
    verified: true;
  };
};
```

Public artifact can omit provider raw payloads while preserving their evidence hash/source reference.

## 5. Zero-price proof

The public UI should distinguish:

```text
Mint price: 0 ETH
Network gas spent by community collector: X ETH
```

Do not call the whole transaction “free” without the gas qualification.

The `nativeMintValueAtomic` field is the exact transaction value sent to the mint target and must equal zero under Collector V1.

Gas is not a project purchase price.

## 6. Complete inventory proof

The public inventory manifest should list exactly the NFTs acquired by that one mint run:

```text
collection
tokenId
acquisition tx hash
acquisition log index
```

Canonical inventory hash is computed before randomness output is available under the normative fairness policy.

Public proof should make it obvious that an NFT could not be removed after the operator saw its traits/value without changing `inventoryHash`.

## 7. Fairness proof packet

Reference public allocation data:

```text
mintRunId
allocation anchor block/hash
census hash
community floor
eligible floor cohort count
acquired quantity
selected seat count
fairness policy version/hash
randomness policy version/hash
randomness source/round/record hash
allocation result hash
```

A detailed proof can include assignments by Square:

```text
NFT collection/tokenId
→ selected CCFF00 tokenId
→ canonical TBA
→ delivery tx hash/status
```

The public proof does not need to label the controlling owner EOA prominently; anyone who needs to verify can derive ownership at the anchor block from chain state.

## 8. Why the allocation was fair

Public explanation should be concise and mechanical:

```text
1 current owner wallet = 1 seat
only least-served seats eligible
Square count = no extra odds
ETH donations = no extra odds
NFT value/rarity = not used
automatic quantity <= eligible floor cohort
randomness round determined from acquisition block + fixed policy
inventory committed before randomness
```

Do not claim financial equality. The engine cannot know which NFT will appreciate.

## 9. Reproducibility tool later

A future read-only verifier/CLI can accept a mint-run public proof packet and:

1. verify chain IDs/hashes;
2. reconstruct/validate acquisition receipt inventory;
3. reconstruct historical CCFF00 census at acquisition block;
4. verify fairness state checkpoint;
5. derive expected drand round from policy;
6. verify beacon signature/network identity;
7. rebuild deterministic shuffles;
8. reproduce selected seats, token pairing and Square preference orders;
9. compare computed `allocationResultHash` with published result.

Conceptual command only:

```text
pnpm ... verify:community-allocation --mint-run <id>
```

No command name is authorized today.

## 10. Rejected candidate transparency

The engine can optionally expose sanitized aggregate rejection categories such as:

```text
NOT_FREE
WRONG_CHAIN
UNKNOWN_ADAPTER
COLLECTOR_NOT_ELIGIBLE
QUALITY_BELOW_POLICY
RUNTIME_CHANGED
SIMULATION_FAILED
GAS_POLICY_EXCEEDED
NO_ELIGIBLE_FAIRNESS_RECIPIENTS
COLLECTION_COVERAGE_COMPLETE
```

Do not expose raw internal exceptions, provider credentials or security-sensitive stack traces.

A rejected project should not be publicly labeled “scam” solely because it failed an RMT automation policy. Use neutral wording:

> Not admitted by Community Engine V1 policy.

## 11. Quality evidence wording

Public quality/provenance score should be labeled as a **curation decision**, not security guarantee or investment recommendation.

Example:

```text
Automation safety: PASSED
Curation policy: PASSED
```

Possible reason evidence:

```text
known Robinhood project provenance
stable collection metadata
community watch input
nontrivial unique activity
no detected duplicate/copy evidence
```

Do not publish:

```text
"safe investment"
"will go up"
"verified valuable"
```

## 12. Gas-fund transparency

Future gas-fund status should expose at least:

```text
total ETH received
current ETH balance
total ETH released/spent
collector operating balance
recent gas spend
average gas per successful acquired NFT
failed/reverted gas spend
```

Contribution amounts never appear in allocation weights.

A contributor leaderboard is intentionally not required; it could create social pressure suggesting payment buys status when the architecture says it does not.

If individual contributions are shown, display a prominent statement:

> Contributions do not change NFT allocation odds or priority.

## 13. Terminal-revenue funding transparency later

If a future explicit economics decision sends RMT terminal revenue into Community Engine gas funding, public accounting must separate:

```text
community voluntary ETH
RMT operations/treasury contribution
versioned revenue-policy contribution
other admitted funding
```

Do not imply current terminal fees fund the engine until that policy actually exists.

## 14. Collector status transparency

Public status may expose:

```text
engine mode
STOPPED / OBSERVER / CANARY / LIMITED_PRODUCTION
collector address
collector ETH balance
pending acquired inventory count
last successful mint block
last successful delivery block
current admitted adapters
current gas caps (if safe to publish)
current randomness policy version
```

Never expose:

- private key material;
- provider bearer/API credentials;
- internal signer auth tokens;
- sensitive raw diagnostic payloads.

## 15. RMT Pay transparency

Future RMT Pay public metrics should distinguish:

```text
Nominal RMT totalSupply()
Total RMT at 0x...dEaD
Protocol-attributed RMT Pay burns
Legacy immutable retirement-sink RMT
Effective circulating RMT
Sponsored gas ETH spent
```

Important distinction:

```text
Dead-address total
!=
RMT Pay protocol burn total
```

Anyone can independently send RMT to the dead address. Protocol-attributed burn should count only exact confirmed RMT Pay receipts/events/evidence.

## 16. RMT Pay transaction proof

Reference public receipt:

```text
utilityId
payment policy hash
transaction hash
block number/hash
RMT source (ordinary wallet or CCFF00 TBA class)
CCFF00 token ID when applicable
burn amount
burn destination 0x...dEaD
source/dead balance delta proof
gas sponsored yes/no
gas amount
utility success postcondition hash
```

Public UI should make clear:

> RMT Pay did not swap this RMT for ETH.

## 17. Effective circulating supply wording

Because current RMT has immutable nominal `totalSupply()` and no native burn function, use technically accurate wording:

```text
Nominal total supply
Less: dead-address balance
Less: admitted provably unrecoverable retirement sink balances
= effective circulating supply
```

Do not say Solidity `totalSupply()` decreased.

## 18. Historical audit log

Once runtime exists, public proof history should be append-oriented:

```text
mint run
→ acquisition proof
→ randomness/allocation proof
→ delivery proofs
→ repair proofs if any
```

If an assignment required deterministic repair, preserve the original assignment and link the repair rather than rewriting history.

## 19. Failure/uncertain state disclosure

Public status should distinguish:

```text
PENDING
WAITING_FOR_RANDOMNESS
DISTRIBUTING
CONFIRMED
UNCERTAIN
REPAIR_REQUIRED
PAUSED
```

Do not show “failed” merely because an RPC timed out if transaction status is unknown.

## 20. Privacy boundary

The engine does not need offchain PII to allocate NFTs.

V1 should not collect/display:

- names;
- email addresses;
- IP-derived identity;
- device fingerprints;
- inferred same-human wallet clusters.

Public chain addresses/token IDs are inherently public, but UI should expose only what materially improves transparency.

## 21. Public verification claim

The strongest appropriate claim after implementation is something like:

> Community Engine allocation is reproducible from the published acquisition, census, policy and verified randomness evidence.

Do not claim:

- government/auditor certification;
- guaranteed NFT safety/value;
- Sybil-proof one-human-one-seat identity;
- zero smart-contract risk;
- guaranteed project legitimacy.

## 22. Public-proof release gate

Before publishing a “provably fair” label, tests must prove:

- exact acquisition-block census reconstruction;
- deterministic quantity/floor cohort;
- inventory completeness;
- fixed future randomness-round derivation;
- cryptographic beacon verification;
- unbiased deterministic shuffles;
- exact assignment reproduction;
- donor/Square-count/value neutrality;
- delivery receipt linkage;
- no operator rewrite path.

Until then, UI wording should remain “planned”/“observer” rather than claiming proof properties not yet implemented.
