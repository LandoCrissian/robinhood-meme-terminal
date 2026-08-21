# CCFF00 Community Engine acquisition and transient inventory V1

**Status:** PLANNING ONLY — NORMATIVE ACQUISITION/CUSTODY BOUNDARY

This document answers a key design question:

> If a mint protocol supports a separate recipient, should the Community Engine mint directly into a CCFF00 TBA?

For V1, **normally no**.

## 1. Locked V1 acquisition flow

```text
approved zero-price mint
→ isolated Community Collector receives acquired NFT(s)
→ acquisition receipt finalized/reconciled
→ complete inventory manifest committed
→ acquisition-block CCFF00 census/fairness state committed
→ predetermined verified randomness becomes available
→ NFT token IDs + seats randomized
→ delivery to selected current-owned CCFF00 TBAs
```

The collector is therefore **transient custody for acquired community inventory**, not user-fund custody.

## 2. Why direct-to-recipient mint is not the default

If the engine decides a holder/Square before acquisition and asks the mint contract to mint directly there:

- allocation happens before the complete acquired inventory is known;
- token IDs/traits may become correlated with recipient ordering;
- the inventory cannot be committed independently before randomness;
- retries/partial mints may alter who gets which token ID;
- provider/minter ordering could become an unintended assignment mechanism.

The V1 fairness proof is cleaner when:

```text
acquire first
commit exact inventory
then randomize both recipient order and NFT token-ID order independently
```

## 3. Separate payer/recipient support is still useful evidence

Protocols such as SeaDrop can support a separate payer/minter when the collection explicitly permits the payer.

Community Engine may need to understand these semantics for:

- allowlist eligibility;
- project-specific collector arrangements;
- future optimization;
- cases where the collection controls recipient semantics.

But V1 does not use separate-recipient support to bypass the transient inventory commitment/fairness model merely to save one transfer.

## 4. Default mint recipient

For V1 automatic acquisition:

```text
mint recipient = admitted isolated Community Collector
```

where contract semantics permit.

If the mint function is `mint-to-caller`, the collector is caller.

If mint function requires explicit recipient, it must resolve to collector under the admitted V1 adapter unless a separately versioned acquisition mode is reviewed.

## 5. Collector account receiver compatibility

Package G collector technology must be able to receive the admitted NFT family.

### EOA collector

Standard ERC-721 mint-to-EOA does not require ERC721Receiver callback.

### Smart-account/contract collector

If minting/safe-minting calls ERC721Receiver, the collector contract/account must prove exact receiver support before admission.

Do not select a smart-account collector whose NFT-receiver behavior strands acquired inventory.

## 6. Inventory membership is receipt-derived

Only NFTs proven to originate from the admitted mint run become that run's inventory.

Required evidence per item:

```text
collection
tokenId
acquisition transaction hash
mint/Transfer log index
collector ownership postcondition
```

Never define inventory as:

```text
"whatever NFTs are currently in the collector wallet"
```

because the collector could receive unsolicited/spam NFTs.

## 7. Unsolicited NFT rule

If an unrelated NFT is transferred/airdropped to the collector:

- do not auto-allocate it;
- do not include it in any existing inventory manifest;
- flag as `UNSOLICITED_ASSET` / collector-asset drift;
- in production, auto-pause or quarantine according to measured policy if the unexpected asset makes the clean collector invariant uncertain;
- do not interact with malicious/spam NFT contracts merely to “clean” the wallet.

A future safe quarantine/retirement policy is separate.

## 8. No asset sweep/rescue through Community Engine

The collector runtime should not expose a generic:

```text
sweepNFT(anyCollection, anyTokenId, anyRecipient)
```

because that creates an operator path to steal valuable acquired inventory.

Repairs/distribution must be assignment/evidence-bound.

If an unsolicited token requires removal for operational reasons, handle under a separately authorized incident/admin process outside winner allocation, with explicit evidence and no ambiguity with committed inventory.

## 9. Inventory commitment timing

Do not commit inventory on first observed mint event if transaction is not final under current policy.

Sequence:

```text
transaction included
→ receipt decoded
→ acquired items reconciled
→ required confirmation/finality depth
→ collector ownership verified
→ complete inventory manifest built
→ inventoryHash committed
```

If transaction reorgs before commitment, rebuild from canonical chain state.

## 10. Quantity reconciliation

Unsigned mint plan has exact admitted quantity `q`.

After acquisition:

```text
number of unique admitted acquired NFTs == q
```

or reconciliation fails.

Do not silently allocate a partial result as though the plan had requested fewer unless the admitted adapter explicitly defines partial-mint semantics and a separately reviewed policy handles them. Standard V1 should prefer atomic quantity semantics.

## 11. Token ID derivation

Do not assume:

```text
firstTokenId + i
```

or collection-wide sequential numbering even if common ERC721A implementations use it.

Parse exact canonical receipt events and verify final ownership.

For ERC-721:

```text
Transfer(from=zero, to=collector, tokenId)
```

is the typical acquisition event, subject to adapter semantics.

If mint emits custom events but ERC-721 Transfer also exists, cross-check as appropriate.

## 12. Same-transaction transfers

Reject/handle carefully if the mint transaction causes NFT to be minted to one address and immediately transferred elsewhere before completion.

V1 postcondition requires the admitted acquired item to be owned by collector after acquisition transaction unless a separately approved adapter explicitly defines another custody flow.

This prevents hidden payout/recipient behavior from becoming inventory.

## 13. Delayed reveal

Delayed reveal is compatible with fairness when:

- NFT is transferable;
- token ID is known at acquisition;
- assignment occurs without waiting for trait/value reveal;
- no operator can delay/randomness-select based on revealed traits.

Preferred V1:

```text
allocate based on token identity immediately after required acquisition/fairness/randomness process
```

not:

```text
wait for rarity reveal, then distribute
```

A delayed reveal can actually strengthen value-blind assignment if allocation commits before traits are known.

## 14. Already-revealed collection

If traits are already visible at acquisition:

- inventory still canonical-sorts/shuffles by collection+tokenId only;
- trait/rarity metadata is excluded from allocator input;
- operator cannot remove an item after seeing traits.

## 15. Metadata mutation after allocation

A creator may change mutable metadata later.

This does not alter fairness history. Public proofs record collection/token ID and acquisition/delivery evidence, not a guarantee that offchain metadata never changes.

Quality policy may disclose mutability/freeze state before acquisition.

## 16. Collector inventory exposure limit

Package H policy should cap:

```text
maxPendingInventory
```

including:

- finalized acquired NFTs waiting for randomness;
- assignments waiting for delivery;
- repair-required committed inventory.

If cap reached:

```text
NO NEW MINT
```

until inventory resolves.

## 17. Time-to-distribution objective

Do not set an arbitrary SLA now, but minimize custody duration subject to:

- acquisition finality;
- historical census reconstruction;
- fixed future randomness lead;
- beacon availability/verification;
- delivery gas caps;
- ownership refresh.

A short deterministic randomness lead reduces collector custody exposure, but it must leave enough time for finality/evidence publication and reliable beacon availability. Package E resolves measured `randomnessLeadSeconds`.

## 18. Collector compromise during pending inventory

If collector signer is suspected compromised while holding committed inventory:

1. STOP new signing;
2. reconcile current NFT ownership;
3. do not reroll/reassign merely because key is compromised;
4. if inventory is stolen before delivery, mark affected assignments/inventory as incident/lost and preserve proof history;
5. rotate collector under reviewed recovery; do not pretend stolen NFT was delivered.

Do not grant treasury/admin wallet emergency generic access to committed collector inventory as a standing feature just to simplify this incident case.

## 19. Distribution authorization consumes exact inventory item

Delivery plan binds:

```text
mintRunId
inventoryHash
collection
tokenId
assignmentId
selected seat
Square preference order
```

Before sign:

```text
collector still owns exact NFT
```

After confirmed delivery:

```text
collector no longer owns NFT
canonical selected TBA owns NFT
```

Then and only then mark inventory item `DELIVERED` and fairness counters confirmed.

## 20. No secondary trading

Community Engine V1 does not:

- list acquired NFTs;
- sell them;
- accept bids;
- swap them;
- use them as collateral;
- stake them;
- choose to retain a valuable one.

Every admitted acquired NFT is intended for the committed fair distribution lifecycle.

## 21. Failed delivery does not release item for another winner

If assignment to selected seat fails:

```text
NFT remains bound to that assignment/repair process
```

Do not immediately give the same NFT to another seat, because that would let delivery failures alter random outcomes.

Repair rules preserve the selected seat unless the specialized fairness policy explicitly defines a transparent terminal failure resolution.

## 22. Future direct-mint optimization

A future V2 could consider direct mint to final TBA only if it can prove equivalent fairness, for example with:

- recipient selection before token ID without exploitable ordering;
- collection token IDs/traits provably unpredictable until after assignment;
- complete auditability;
- no provider ordering control;
- handling partial mint failures;
- no reduction in collection coverage fairness.

V1 deliberately chooses the simpler verifiable model instead of saving one NFT transfer transaction.

## 23. Gas tradeoff

Transient custody means one extra NFT transfer per delivered NFT compared with direct mint-to-recipient.

That gas cost is intentional V1 fairness/security overhead and belongs in `GAS_COST_MODEL_V1.md`.

If the overhead later becomes material, optimize only after preserving equivalent proof properties.

Do not trade fairness auditability for tiny gas savings by default.

## 24. Public transparency

Public mint-run proof should show:

```text
collector acquired exact inventory
inventoryHash committed
randomness record
allocation result
NFT delivery tx to CCFF00 TBA
```

This chain of evidence makes transient collector custody transparent rather than hidden.

## 25. V1 invariant

For every successful Community Engine mint-run item:

```text
acquisition:
  zero-address mint → collector

then exactly one final Community Engine delivery:
  collector → assigned canonical CCFF00 TBA
```

unless an explicit incident/repair state is publicly recorded.

That is the default V1 asset lifecycle.
