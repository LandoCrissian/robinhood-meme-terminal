# CCFF00 Community Engine mint adapters V1

**Status:** PLANNING ONLY — FUTURE IMPLEMENTATION INPUT  
**Automatic scope:** Robinhood Chain `4663`, zero-native-value NFT acquisition only.

This document defines how a free-mint opportunity becomes an admitted execution plan. Discovery providers may suggest transactions; they never become execution authority.

## 1. Adapter principle

Automatic execution is allowed only through a versioned mint adapter whose semantics are understood in advance.

```text
provider / watch input
  ↓
candidate
  ↓
adapter classification
  ↓
local onchain evidence
  ↓
exact decode
  ↓
exact simulation
  ↓
unsigned hash-bound plan
```

Unknown selectors or unrecognized contract families remain observer-only.

The engine must never implement a generic `call arbitrary target with arbitrary calldata` mint executor.

## 2. Adapter identity

A `MintAdapterV1` definition should bind:

```text
adapterId
adapterVersion
chainId
contractFamily
admittedTargetIdentities[]
admittedSelectors[]
collectionValidationMode
proxyValidationMode
recipientSemantics
quantitySemantics
priceSemantics
allowlistSemantics
requiredStateReads[]
requiredSimulation
requiredReceiptEvents[]
postconditions[]
```

Adapter changes that expand accepted targets/selectors/semantics require a new version and review.

## 3. Common hard requirements

Every V1 adapter must enforce:

```text
chainId == 4663
mint target has runtime bytecode
collection has runtime bytecode
adapter selector matches exact decoded calldata
native transaction value == 0
quantity > 0
quantity <= creator/project limit when known
quantity <= RMT local policy cap
stage active at final pre-sign check
exact recipient semantics known
exact expected mint event/postcondition known
simulation succeeds at fresh state
max gas policy passes
collector policy passes
engine == RUNNING at signing boundary
```

If a provider says `price = 0` but returned transaction `value != 0`, reject.

If decoded mint parameters say a nonzero mint price while transaction value is zero, reject rather than relying on a likely revert.

## 4. Runtime/proxy evidence

For both mint target and collection, classify at least:

- direct implementation;
- EIP-1967 proxy when provable;
- EIP-1167 minimal proxy when provable;
- unknown proxy/delegation surface.

For an admitted proxy:

```text
proxy address
proxy runtime hash
implementation address
implementation runtime hash
implementation evidence block
```

must be bound into `MintEvidenceV1`.

Unknown/decode-ambiguous upgradeability is observe-only until explicitly handled.

A verified explorer source is useful evidence, not enough by itself. Runtime identity and local ABI semantics remain required.

## 5. OpenSea is discovery/transaction construction, not trust

OpenSea's Drops API can be used to:

- discover featured/upcoming/recent drops;
- inspect stages and provider metadata;
- request mint transaction construction.

At implementation time, probe live Robinhood support before admission.

Returned values such as target/calldata/value are treated exactly like untrusted provider quote data:

1. normalize;
2. decode locally using an admitted adapter;
3. independently read live contract state;
4. verify zero value;
5. simulate;
6. hash-bind the exact plan.

If the API is unavailable or no longer supports Robinhood, explicit `WATCH PROJECT` and future onchain discovery can continue in observer mode.

## 6. First contract-family candidate: SeaDrop public mint

OpenSea's open-source SeaDrop contract exposes:

```solidity
mintPublic(
  address nftContract,
  address feeRecipient,
  address minterIfNotPayer,
  uint256 quantity
)
```

Source semantics establish:

- stored public-drop start/end times;
- stored mint price;
- exact payment check for `quantity * mintPrice`;
- per-minter wallet quantity enforcement;
- optional restricted fee recipients;
- if `minterIfNotPayer != msg.sender`, the payer must be explicitly allowed by the NFT contract's SeaDrop configuration.

### V1 collector policy

For the simplest automatic collector path:

```text
msg.sender = dedicated collector
minterIfNotPayer = zero address
resolved minter = dedicated collector
mintPrice = 0
msg.value = 0
```

The Collector mints to itself, reconciles exact acquired token IDs, commits inventory, then distributes later. Do not direct-mint to a CCFF00 TBA merely to save a transfer until the recipient/account/allowlist semantics have been separately proven.

### Admission reads

The SeaDrop adapter must independently verify the applicable public-drop state and any required fee-recipient/payer configuration from the exact deployed SeaDrop target.

Do not hard-code a SeaDrop mainnet address from another chain. Discover and verify the Robinhood deployment/runtime at implementation time.

## 7. SeaDrop allowlist candidate

SeaDrop also exposes:

```solidity
mintAllowList(
  address nftContract,
  address feeRecipient,
  address minterIfNotPayer,
  uint256 quantity,
  MintParams mintParams,
  bytes32[] proof
)
```

The open-source contract verifies a Merkle leaf equivalent to:

```text
keccak256(abi.encode(minter, mintParams))
```

against the collection's current allowlist root.

### Collector allowlisted

If the dedicated collector itself is the admitted minter/leaf and the stage price is zero, this can be automated after exact proof/root/parameter verification.

### Individual CCFF00 owners allowlisted

If leaves are individual holder EOAs, the collector cannot claim their entitlement merely because those users own CCFF00.

Even if a separate payer is allowed, SeaDrop's `minter` identity is the address bound into the proof and receives the NFT. Therefore an EOA-holder allowlist does not automatically produce an NFT controlled by the central collector or the holder's CCFF00 TBA.

V1 must report this as incompatible with centralized acquisition unless the project's exact configuration provides a separately verified delegated/gift mechanism that preserves creator intent.

No burner wallets, proof reuse or wallet-limit evasion.

## 8. SeaDrop server-signed mint

SeaDrop supports server-side signed mints, but this introduces project signer parameters, EIP-712 digest rules and one-time signature handling.

Initial V1 disposition:

```text
observe / decode = allowed
fully automatic execution = NOT ADMITTED BY DEFAULT
```

Add only after a separate adapter version proves signer identity, parameter bounds, replay rules, zero price, exact collector/minter semantics and expiration.

## 9. Token-gated minting

Token-gated stages can consume/redeem eligibility tied to external token/NFT ownership.

Initial V1 disposition:

```text
observe only
```

The engine must not transfer valuable CCFF00/RMT/other assets into the isolated collector simply to satisfy a token-gated mint. That would violate the collector's low-value security boundary.

A future non-custodial delegated mechanism can be evaluated separately.

## 10. Generic custom ERC-721 mint functions

Function names such as:

```text
mint(uint256)
publicMint(uint256)
mint(address,uint256)
claim(...)
```

are not standards. Same selectors/ABIs can have materially different behavior across contracts.

Do not create a selector-only generic adapter.

A custom adapter requires:

- verified source or independently reconstructed ABI semantics;
- runtime/implementation identity;
- exact price state read;
- exact recipient semantics;
- exact wallet-limit semantics;
- exact receipt/postconditions;
- adversarial fixtures;
- explicit adapter version admission.

## 11. ERC-721 collection postconditions

A successful acquisition plan must define how the minted items are discovered and verified.

Prefer canonical ERC-721 `Transfer` logs:

```text
Transfer(from = zeroAddress, to = collector, tokenId)
```

but do not blindly accept every zero-address transfer in the transaction. Scope to the exact admitted collection and reconcile expected quantity.

After receipt:

- transaction status is success;
- exactly the expected number of admitted mint events exist;
- every discovered token ID is unique;
- `ownerOf(tokenId) == collector` at the confirmation block/fresh reconciliation state;
- no unrelated NFT/token/ETH value delta violates policy.

If a collection mints through nonstandard events/ownership behavior, it requires its own adapter.

## 12. ERC-1155 boundary

ERC-1155 is not part of the first automatic mint adapter release.

A future ERC-1155 adapter must account for:

- `TransferSingle` and `TransferBatch`;
- token ID + amount inventory identity;
- balance-before/balance-after exact deltas;
- CCFF00 TBA ERC-1155 receiver compatibility canary;
- distribution amount accounting.

Do not infer ERC-1155 support from the existing generic RMT distribution domain alone.

## 13. Metadata/media safety is separate from mint safety

NFT metadata can reference attacker-controlled URLs/content. Quality inspection must not give metadata privileged network/file access.

Requirements for future metadata enrichment:

- bounded response size/time;
- HTTP(S)/IPFS gateway policy only as explicitly admitted;
- SSRF/private-network protections;
- no local file schemes;
- no execution of returned HTML/JavaScript;
- SVG/HTML treated as untrusted active content;
- failures degrade quality evidence, not transaction safety;
- reuse RMT's existing bounded request/media-guard patterns where appropriate.

A perfectly safe mint transaction can still produce low-quality/malicious metadata. Keep the two decisions separate.

## 14. Quality gate versus safety gate

### Safety gate

Binary and deterministic:

```text
PASS
FAIL
UNKNOWN → FAIL FOR AUTO-EXECUTION
```

### Quality/provenance gate

Versioned evidence score/reasons. Initial production should require either:

- explicitly reviewed quality admission; or
- an observer-mode model whose autonomous threshold has been separately approved after real-world evaluation.

No AI/heuristic quality score can override a hard transaction-safety failure.

## 15. Mint plan freshness

A plan must expire quickly enough that it cannot be signed after material mint state changes.

Immediately before signing, re-read/reverify at least:

- stage active;
- mint price still zero;
- per-wallet remaining quantity;
- relevant allowlist root/proof identity;
- target/proxy implementation identity;
- collector balance/gas policy;
- transaction simulation;
- engine RUNNING state.

Any mismatch invalidates the old plan and produces a new evidence/plan hash.

## 16. Gas policy

No numeric mainnet caps are approved during planning.

The adapter consumes a separately versioned execution policy with explicit non-null values for:

```text
maxQuantityPerMint
maxGasLimitPerTransaction
maxWeiPerTransaction
maxWeiPerMintRun
maxWeiPerDay
maxPendingInventory
```

Missing caps disable signing. Never use permissive defaults.

## 17. Collector holdings policy

Before automatic acquisition:

```text
RMT balance == 0
CCFF00 balance == 0
unrelated valuable ERC-20 balance == 0
unrelated approvals == 0
NFT inventory <= admitted transient inventory cap
ETH <= operational cap (+ explicitly allowed in-flight refill tolerance)
```

Unexpected assets do not become available for minting. They trigger a halt/review path; do not add generic rescue/sweep authority as an automatic convenience.

## 18. Required adapter test matrix

Every adapter version needs adversarial coverage for at least:

- wrong chain;
- wrong target codehash;
- proxy implementation changed;
- wrong selector;
- malformed calldata;
- nonzero transaction value;
- provider reports free but contract price nonzero;
- stage not started/expired;
- quantity zero/over project limit/over local cap;
- invalid/stale allowlist proof;
- collector not allowed payer when separate payer semantics used;
- fee-recipient restriction mismatch;
- simulation revert;
- gas over cap;
- receipt quantity mismatch;
- unexpected collection/token event;
- post-mint owner mismatch;
- duplicated token ID;
- engine STOP before sign;
- plan expiration/state drift.

## 19. Adapter registry release rule

The runtime adapter registry, when eventually implemented, should be positive-allowlist only.

An adapter becomes auto-executable only when its exact version has:

1. source/semantics review;
2. fixtures and adversarial tests;
3. Robinhood live-state identity evidence;
4. zero-value free-mint proof;
5. simulation proof;
6. receipt/postcondition proof;
7. explicit release admission.

Adding a provider URL or `WATCH PROJECT` entry never adds an adapter.

## 20. Known external reference

OpenSea's SeaDrop source currently provides a concrete reusable reference for public and allowlist mint semantics. RMT should depend on locally pinned ABI/semantics/runtime evidence, not dynamically execute whatever a provider labels as SeaDrop.
