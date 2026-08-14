# RMT Helium RWA — evidence registry V0 specification

**Status:** RESEARCH SPECIFICATION — NO IMPLEMENTATION AUTHORIZED  
**Date:** 2026-08-14  
**Target network for a future prototype:** Robinhood Chain testnet, chain ID `46630`  
**Production network:** explicitly out of scope  
**Asset issuance:** explicitly out of scope  
**Working contract name:** `RMTCommodityEvidenceRegistryV0`  

> This specification defines a testnet-only evidence registry. It does not create a token, commodity entitlement, security, warehouse receipt, document of title, reserve, custody arrangement, price feed, investment product, or redemption right. All V0 fixtures must be synthetic and visibly labeled as having no real-world or monetary value.

## 1. Decision

The first technical implementation should be an **append-only physical-commodity evidence registry**, not a helium token.

The registry's job is narrow:

> Prove that a specific set of parties signed the same version of a structured evidence package for a specifically identified physical lot, on a specific chain and registry deployment, for a bounded period of time.

The registry cannot prove physical reality by itself. It can only prove:

- which signing identities were admitted;
- which structured facts they signed;
- which manifest hashes were committed;
- when the evidence became valid and expired;
- whether a later version superseded it;
- whether the record was disputed, suspended, or closed;
- whether the same physical-lot key was already active in the registry;
- whether a configured quorum was satisfied.

The physical truth still depends on legal documents, calibrated measurement, representative sampling, custody records, encumbrance searches, and competent independent review.

## 2. V0 objectives

V0 must demonstrate:

1. **Typed evidence** rather than a generic URL or PDF hash.
2. **Multiple accountable parties** rather than issuer self-attestation.
3. **Domain-separated signatures** bound to chain ID, verifying contract, schema, instrument, lot, version, nonce, and expiry.
4. **Append-only version history** with no silent overwrite.
5. **Automatic freshness semantics** so expired evidence cannot remain `verified`.
6. **Fail-closed encumbrance semantics** so `unknown` cannot be presented as `clear`.
7. **Duplicate-lot resistance** so the same active lot key cannot back multiple admitted records without an explicit supersession relationship.
8. **Public/private evidence separation** so commercial or security-sensitive documents are not published onchain.
9. **Synthetic-only demonstration** with zero mint authority and no asset-transfer functions.
10. **Canonical RMT read model** that can explain exactly what was and was not verified.

## 3. Non-goals

V0 must not:

- issue ERC-20, ERC-721, ERC-1155, ERC-3525, ERC-3643, ERC-6909, or any other transferable asset;
- accept user funds;
- hold ETH or ERC-20 balances;
- transfer assets;
- mint, burn, wrap, unwrap, bridge, swap, lend, borrow, or collateralize anything;
- set a helium price;
- call an oracle;
- call arbitrary external contracts;
- store private legal documents onchain;
- determine that a legal entity is independent merely because it has a different wallet;
- determine legal title from a token balance;
- determine jurisdictional eligibility;
- claim that an evidence signature is an audit opinion;
- claim that a producer, custodian, laboratory, or Robinhood supports RMT;
- alter canonical Robinhood Stock Token identity;
- grant rights to RMT-token holders;
- enter production or mainnet.

## 4. System context

```text
                         OFFCHAIN EVIDENCE DOMAIN

 synthetic issuer ─────────────────────────────────────────────┐
                                                              │
 synthetic custodian ──► canonical full manifest ─────────────┼──► EIP-712 signatures
                                                              │
 synthetic attestor ───────────────────────────────────────────┘
                                  │
                                  ├── public redacted manifest
                                  ├── private/full manifest hash
                                  ├── schema hash
                                  └── source-document commitments
                                           │
───────────────────────────────────────────┼────────────────────────────
                                           │
                              ROBINHOOD CHAIN TESTNET
                                           ▼
                            RMTCommodityEvidenceRegistryV0
                                  │             │
                                  │             ├── party identities / keys
                                  │             ├── instrument configuration
                                  │             ├── lot uniqueness
                                  │             ├── evidence versions
                                  │             ├── signature verification
                                  │             ├── expiry / status
                                  │             └── append-only events
                                  ▼
                                  RMT read model
                                  │
                                  ├── evidence status
                                  ├── signer status
                                  ├── rights / restrictions
                                  ├── quantity / quality
                                  ├── custody / title claims
                                  ├── encumbrance
                                  ├── freshness
                                  ├── sources
                                  └── unknowns / disputes
```

## 5. Terminology

### Instrument

A legal/economic program definition, not a ticker. In V0 it is synthetic and grants no rights.

Example synthetic label:

`RMT-HE-DEMO-V0`

### Series

A set of evidence records intended to share a common specification, governing-document version, and eligibility model. V0 may define a series identity even though no token exists.

### Batch / lot

A specifically identified quantity of physical commodity under one inventory-control identity. The words `batch` and `lot` are not interchangeable in every physical operation; the canonical manifest must define the operator's actual accounting term.

### Physical-lot key

A deterministic commitment intended to prevent the same active lot from being admitted twice under different display names.

### Evidence version

A monotonic, immutable record for one instrument/batch. A new version supersedes but never deletes the prior version.

### Public manifest

A canonical JSON document containing fields safe and necessary for public verification.

### Full manifest

A canonical document that may include confidential legal, custody, location, commercial, or document identifiers. Only its cryptographic hash is public in V0.

### Evidence party

A legal entity or test fixture with an admitted signing key and role. A wallet address alone is not a legal identity.

### Signer role

One of the configured roles for a record, initially:

- `ISSUER`
- `CUSTODIAN`
- `ATTESTOR`

Additional roles require a new schema/version rather than an unstructured string.

### Attestor

A party signing a defined evidence scope. The label does not automatically mean auditor, CPA, laboratory, trustee, or independent assurance provider. The public manifest must state the exact scope.

### Encumbrance

An offtake, sale, lien, pledge, security interest, financing claim, prior tokenization, custody restriction, or other competing claim that may impair availability or title.

## 6. Trust model

### 6.1 What the contract trusts

The registry trusts only:

- its immutable code;
- configured role and party records;
- signature validation;
- explicit state transitions;
- block timestamps within normal EVM limitations;
- collision resistance of the selected hash functions;
- deterministic canonicalization performed by the publishing tooling.

### 6.2 What the contract cannot verify

The registry cannot independently verify:

- that helium physically exists;
- that a sample was representative;
- that a meter was calibrated correctly;
- that a legal entity owns the lot;
- that all liens or prior sales were disclosed;
- that a PDF is legally enforceable;
- that a signer had internal corporate authority;
- that an attestor is independent;
- that a custodian is solvent;
- that a jurisdiction recognizes token-linked title;
- that redemption will occur.

The UI must not convert a valid signature into a broader claim than the signer made.

### 6.3 Quorum model

V0 requires three distinct roles for `VERIFIED` eligibility:

```text
issuer signature
AND custodian signature
AND attestor signature
```

The three roles must resolve to three different admitted `partyId` values. Separate wallet addresses controlled by the same legal entity do not establish independence.

The manifest must disclose beneficial/control relationships if known. V0 tooling should warn when admitted parties share a declared control group.

### 6.4 Governance

V0 governance is limited to testnet registry administration:

- admit/revoke synthetic party identities;
- configure a synthetic instrument;
- suspend a record;
- rotate keys under explicit delay or signed replacement procedure;
- close the test deployment.

Recommended prototype governance:

- a test multisig rather than one EOA;
- no custody capability;
- no arbitrary-call executor;
- no proxy upgrade;
- deployment versioning instead of mutation of code;
- explicit events for every administrative action.

A future real pilot would require a separately designed governance and legal authority model.

## 7. Identifiers

All identifiers are `bytes32` commitments derived from canonical inputs.

### 7.1 Schema identifier

```text
schemaHash = keccak256(canonical schema bytes)
```

The schema itself must be published in the repository and through an immutable content-addressed reference.

### 7.2 Party identifier

```text
partyId = keccak256(
  jurisdiction code
  || legal registration authority
  || normalized legal registration number
  || legal entity name version
)
```

For V0 synthetic fixtures, use reserved synthetic namespaces and never real registration numbers.

A party ID must not be generated solely from a wallet address.

### 7.3 Instrument identifier

```text
instrumentId = keccak256(
  schemaHash
  || issuerPartyId
  || governingInstrumentHash
  || instrumentNamespace
  || instrumentVersion
)
```

### 7.4 Series identifier

```text
seriesId = keccak256(
  instrumentId
  || commoditySpecHash
  || quantityStandardHash
  || rightsVersionHash
  || transferPolicyHash
)
```

### 7.5 Batch identifier

```text
batchId = keccak256(
  seriesId
  || producerPartyId
  || operatorInventoryIdHash
  || custodyAccountIdHash
  || creationNonce
)
```

### 7.6 Physical-lot key

The physical-lot key is intended to detect duplicate claims across display names and evidence versions:

```text
physicalLotKey = keccak256(
  producerPartyId
  || operatorInventoryIdHash
  || custodyAccountIdHash
  || quantityStandardHash
  || commoditySpecHash
)
```

The key is not proof that two offchain identifiers refer to different physical matter. It is a registry-level duplicate-prevention control.

### 7.7 Manifest hashes

```text
publicManifestHash = keccak256(canonical public JSON bytes)
fullManifestHash   = keccak256(canonical full manifest bytes)
```

The public and full hashes must be distinct fields. Publishing only one ambiguous `documentHash` is rejected.

## 8. Canonical manifest

### 8.1 Canonicalization

The publishing tool must define exactly:

- UTF-8 encoding;
- Unicode normalization;
- key ordering;
- number representation;
- timestamp representation;
- omitted versus null fields;
- array ordering;
- URI normalization;
- line-ending behavior;
- schema validation before hashing.

A future implementation should use an established canonical JSON scheme or an equivalently strict deterministic encoder. The exact choice must be recorded before signatures are generated.

### 8.2 Public manifest shape

Illustrative, not final JSON Schema:

```json
{
  "schema": "rmt.physical-commodity-evidence.v0",
  "environment": "synthetic-testnet",
  "instrument": {
    "instrumentId": "0x...",
    "seriesId": "0x...",
    "displayName": "Synthetic Colorado Helium Evidence Demo",
    "commodityClass": "physical_helium",
    "rightsType": "no_rights_test_fixture",
    "transferability": "none",
    "mintAuthorization": "0"
  },
  "batch": {
    "batchId": "0x...",
    "physicalLotKey": "0x...",
    "producerPartyId": "0x...",
    "custodianPartyId": "0x...",
    "attestorPartyId": "0x...",
    "operatorInventoryIdHash": "0x...",
    "custodyAccountIdHash": "0x..."
  },
  "commodity": {
    "name": "helium",
    "physicalState": "gaseous",
    "quantity": "170000",
    "quantityUnit": "standard_cubic_foot",
    "quantityStandardHash": "0x...",
    "minimumPurityPpm": "999990",
    "commoditySpecHash": "0x...",
    "publicRegion": "synthetic-colorado-region",
    "containerType": "synthetic_stationary_storage"
  },
  "evidence": {
    "titleClaimScope": "synthetic_only",
    "custodyClaimScope": "synthetic_only",
    "quantityClaimScope": "synthetic_only",
    "qualityClaimScope": "synthetic_only",
    "encumbranceStatus": "synthetic_clear",
    "sourceCommitments": ["0x..."],
    "fullManifestHash": "0x...",
    "validFrom": "2026-08-14T00:00:00Z",
    "validUntil": "2026-09-13T00:00:00Z"
  },
  "redemption": {
    "available": false,
    "minimumQuantity": null,
    "method": "none_test_fixture"
  },
  "disclosures": {
    "synthetic": true,
    "monetaryValue": false,
    "physicalBacking": false,
    "robinhoodAffiliation": false,
    "rmtTokenRights": false
  }
}
```

### 8.3 Required evidence categories for a future real pilot

The schema must reserve explicit categories for:

- legal issuer/obligor identity;
- producer identity;
- title holder;
- custodian;
- inventory-control identifier;
- quantity measurement;
- measurement method;
- meter/device identity;
- calibration evidence;
- uncertainty/tolerance;
- standard temperature/pressure definition;
- sample identity;
- sampling method;
- chain of custody;
- purity and impurity results;
- physical state;
- container/storage system;
- public region and confidential precise location;
- insurance;
- offtake status;
- lien/security-interest status;
- prior sale/pledge/tokenization status;
- governing instrument;
- holder rights;
- transfer restrictions;
- redemption method/minimum/cost/lead time;
- evidence validity window;
- signer scope and qualifications;
- exceptions and unresolved items.

A missing required category must not be represented as a negative result. `not_provided`, `not_applicable`, `unknown`, and `clear` are different states.

## 9. Party registry

### 9.1 Party record

Conceptual structure:

```solidity
struct PartyRecord {
    bytes32 partyId;
    bytes32 legalIdentityCommitment;
    bytes32 declaredControlGroupId;
    address signingAccount;
    uint64 validFrom;
    uint64 validUntil;
    uint64 keyVersion;
    PartyStatus status;
    uint256 roleBitmap;
}
```

### 9.2 Party status

```text
UNREGISTERED
ACTIVE
SUSPENDED
REVOKED
EXPIRED
```

### 9.3 Key rotation

Key rotation must:

- create a new key version;
- preserve the old key and its validity interval;
- never make old valid signatures unverifiable;
- require governance authorization plus, where possible, a signature from the old key or documented emergency process;
- emit a complete rotation event;
- prevent retroactive use of a new key for an old evidence timestamp.

### 9.4 Contract-wallet signatures

The verifier should support:

- ECDSA signatures from EOAs;
- ERC-1271 signatures from contract wallets/multisigs.

Signature verification must use a bounded and reviewed path. An ERC-1271 signer can execute its own validation logic; the registry must treat it as an external call surface and defend against reentrancy and pathological gas behavior.

Official standards:

- EIP-712: https://eips.ethereum.org/EIPS/eip-712
- ERC-1271: https://eips.ethereum.org/EIPS/eip-1271
- ERC-5267: https://eips.ethereum.org/EIPS/eip-5267

## 10. EIP-712 evidence envelope

### 10.1 Domain

Recommended domain:

```text
name:              RMTCommodityEvidenceRegistry
version:           0
chainId:           block.chainid
verifyingContract: address(this)
```

The contract should expose its domain through ERC-5267 if implemented.

### 10.2 Primary type

Conceptual typed structure:

```solidity
struct EvidenceEnvelope {
    bytes32 schemaHash;
    bytes32 instrumentId;
    bytes32 seriesId;
    bytes32 batchId;
    bytes32 physicalLotKey;
    uint64 evidenceVersion;
    bytes32 publicManifestHash;
    bytes32 fullManifestHash;
    bytes32 rightsVersionHash;
    bytes32 transferPolicyHash;
    bytes32 encumbranceStatementHash;
    uint64 validFrom;
    uint64 validUntil;
    uint256 nonce;
}
```

### 10.3 Signature scope

All required parties sign the same envelope hash.

V0 rejects designs where:

- the issuer signs one PDF;
- the custodian signs a different spreadsheet;
- the attestor signs only a quantity number;
- the registry combines them without a shared canonical envelope.

Parties may attach role-specific scope statements inside the full manifest, but each signature must bind the complete package and the exact scope hashes.

### 10.4 Replay protection

EIP-712 alone does not provide complete replay protection. V0 must bind:

- `chainId` in the domain;
- verifying contract in the domain;
- schema version;
- instrument, series, batch, and physical-lot key;
- monotonic evidence version;
- per-instrument or per-party nonce;
- validity interval;
- consumed envelope digest.

The registry must reject a digest already consumed, even if all signatures remain valid.

### 10.5 Signature order

Signature input order must not change semantics. The call should identify each signature's role and expected party ID explicitly rather than assuming array position without validation.

## 11. Evidence state machine

### 11.1 Stored status

```text
PROPOSED
VERIFIED
DISPUTED
SUSPENDED
CLOSED
SUPERSEDED
```

### 11.2 Derived freshness

`STALE` should be derived when:

```text
block.timestamp > validUntil
```

A stored `VERIFIED` status must never cause an expired record to display as currently verified.

Recommended effective status priority:

```text
if status == CLOSED:       CLOSED
else if status == SUSPENDED: SUSPENDED
else if status == DISPUTED:  DISPUTED
else if status == SUPERSEDED: SUPERSEDED
else if now > validUntil:    STALE
else if status == VERIFIED:  VERIFIED
else:                        PROPOSED
```

### 11.3 Valid transitions

```text
PROPOSED   → VERIFIED
PROPOSED   → SUSPENDED
PROPOSED   → CLOSED

VERIFIED   → DISPUTED
VERIFIED   → SUSPENDED
VERIFIED   → SUPERSEDED
VERIFIED   → CLOSED

DISPUTED   → SUSPENDED
DISPUTED   → SUPERSEDED
DISPUTED   → CLOSED

SUSPENDED  → SUPERSEDED
SUSPENDED  → CLOSED

SUPERSEDED → CLOSED
```

Reactivation of a disputed/suspended version is prohibited. Corrections require a new evidence version.

### 11.4 Supersession

A new version must state:

- the prior version;
- reason code;
- whether quantity changed;
- whether the physical-lot key changed;
- whether custody/title/encumbrance changed;
- whether the new version narrows or expands any claim.

The old version remains queryable and event history remains complete.

## 12. Encumbrance model

### 12.1 Required statuses

```text
UNKNOWN
CLEAR_WITHIN_STATED_SCOPE
OFFTAKE_COMMITTED
PLEDGED_OR_LIENED
PRIOR_SALE_OR_ASSIGNMENT
PRIOR_TOKENIZATION
DISPUTED
NOT_APPLICABLE_SYNTHETIC
```

`CLEAR_WITHIN_STATED_SCOPE` must include:

- search scope;
- search date;
- jurisdictions/registries checked;
- documents reviewed;
- exclusions;
- signer/party responsible.

The word `clear` without scope is prohibited.

### 12.2 Verification eligibility

For a future real record, `VERIFIED` is forbidden when encumbrance status is:

- `UNKNOWN`;
- `OFFTAKE_COMMITTED`, unless the governing instrument explicitly represents that same offtake right and counsel approves;
- `PLEDGED_OR_LIENED` without a documented priority/release structure;
- `PRIOR_SALE_OR_ASSIGNMENT`;
- `PRIOR_TOKENIZATION` without retirement/reconciliation;
- `DISPUTED`.

V0 synthetic fixtures use `NOT_APPLICABLE_SYNTHETIC` or clearly named synthetic states, never an unqualified real-world `CLEAR`.

## 13. Quantity model

### 13.1 Never store an ambiguous quantity

Required components:

- integer quantity;
- scale/decimals;
- unit code;
- quantity-standard hash;
- standard temperature;
- standard pressure;
- measurement method;
- measurement timestamp/window;
- uncertainty/tolerance;
- device/meter identity commitment;
- calibration evidence commitment;
- loss/heel treatment where relevant.

### 13.2 Suggested onchain representation

```solidity
struct QuantityClaim {
    uint256 value;
    uint8 decimals;
    bytes32 unitCode;
    bytes32 quantityStandardHash;
    uint32 uncertaintyPpm;
}
```

The onchain structure is a commitment aid, not a substitute for the manifest.

### 13.3 Equipment capacity is not backing

V0 documentation and tests must explicitly reject:

- trailer water volume;
- vessel geometric volume;
- nameplate plant capacity;
- expected well production;
- underground resource estimates;
- planned deliveries;

as proof of current eligible backing.

Only measured, reconciled commodity quantity under the stated custody/title arrangement can support a future mint cap.

## 14. Quality model

Required components:

- minimum helium purity;
- impurity specification or commodity-spec hash;
- sample identity;
- sampling point;
- sample timestamp;
- sampling method;
- chain-of-custody record;
- laboratory identity;
- laboratory accreditation/scope commitment;
- analytical method;
- result and uncertainty/limits;
- exceptions or contamination findings.

A `99.999%` label without method, sample, date, and specification is insufficient for real verification.

V0 uses synthetic quality results only.

## 15. Public/private evidence split

### 15.1 Public manifest

Should include:

- legal party names or safe public identifiers;
- public region;
- commodity and specification;
- quantity and standard;
- evidence status/freshness;
- signer roles;
- source-document hashes;
- rights and transfer restrictions;
- redemption constraints;
- unresolved issues;
- synthetic disclaimer.

### 15.2 Private/full manifest

May include:

- exact storage address;
- custody account number;
- contract identifiers;
- confidential pricing;
- insurance policy identifiers;
- sample collection details that create physical-security risk;
- full title documents;
- lien-search results;
- personally identifiable information;
- compliance information.

### 15.3 Disclosure rule

The public UI must not state that a private document proves a fact merely because its hash exists. It may state:

> A document identified by this commitment was included in the signed evidence package; the document is not publicly available, and RMT has not independently evaluated it unless the record explicitly says so.

### 15.4 Selective disclosure

A later version may use Merkle commitments so a party can reveal one field/document without exposing the full manifest. V0 may use whole-manifest hashes to minimize complexity, but the schema should not block future selective disclosure.

## 16. Conceptual contract interface

This is pseudocode, not production Solidity.

```solidity
interface IRMTCommodityEvidenceRegistryV0 {
    enum PartyStatus {
        Unregistered,
        Active,
        Suspended,
        Revoked,
        Expired
    }

    enum EvidenceStatus {
        None,
        Proposed,
        Verified,
        Disputed,
        Suspended,
        Closed,
        Superseded
    }

    struct EvidenceEnvelope {
        bytes32 schemaHash;
        bytes32 instrumentId;
        bytes32 seriesId;
        bytes32 batchId;
        bytes32 physicalLotKey;
        uint64 evidenceVersion;
        bytes32 publicManifestHash;
        bytes32 fullManifestHash;
        bytes32 rightsVersionHash;
        bytes32 transferPolicyHash;
        bytes32 encumbranceStatementHash;
        uint64 validFrom;
        uint64 validUntil;
        uint256 nonce;
    }

    struct RoleSignature {
        bytes32 role;
        bytes32 partyId;
        bytes signature;
    }

    function publishEvidence(
        EvidenceEnvelope calldata envelope,
        RoleSignature[] calldata signatures,
        string calldata contentAddressedPublicManifestURI
    ) external returns (bytes32 evidenceId);

    function disputeEvidence(
        bytes32 evidenceId,
        bytes32 reasonCode,
        bytes32 disputeManifestHash,
        string calldata disputeURI
    ) external;

    function suspendEvidence(
        bytes32 evidenceId,
        bytes32 reasonCode
    ) external;

    function closeEvidence(
        bytes32 evidenceId,
        bytes32 reasonCode
    ) external;

    function getEffectiveStatus(bytes32 evidenceId)
        external
        view
        returns (EvidenceStatus storedStatus, bool stale);

    function evidenceDigest(EvidenceEnvelope calldata envelope)
        external
        view
        returns (bytes32);
}
```

### 16.1 Prohibited interface capabilities

The V0 contract must have no:

- payable functions;
- `receive()` or `fallback()` except a reverting fallback;
- ERC token interface;
- token approval;
- arbitrary call/execute;
- sweep/rescue;
- bridge;
- oracle price update;
- proxy upgrade;
- delegatecall;
- asset custodian role;
- self-destruct;
- permit or transfer authorization.

Accidentally sent ETH should revert where technically possible. Any unavoidable forced ETH must remain inaccessible and documented; the contract must not add a sweep function merely to recover it.

## 17. Events

Recommended event family:

```solidity
event PartyRegistered(
    bytes32 indexed partyId,
    address indexed signingAccount,
    uint64 keyVersion,
    uint256 roleBitmap,
    uint64 validFrom,
    uint64 validUntil
);

event PartyStatusChanged(
    bytes32 indexed partyId,
    uint8 previousStatus,
    uint8 newStatus,
    bytes32 reasonCode
);

event PartyKeyRotated(
    bytes32 indexed partyId,
    address indexed previousAccount,
    address indexed newAccount,
    uint64 previousKeyVersion,
    uint64 newKeyVersion
);

event InstrumentConfigured(
    bytes32 indexed instrumentId,
    bytes32 indexed schemaHash,
    bytes32 governingInstrumentHash,
    bool synthetic
);

event EvidencePublished(
    bytes32 indexed evidenceId,
    bytes32 indexed instrumentId,
    bytes32 indexed batchId,
    bytes32 physicalLotKey,
    uint64 evidenceVersion,
    bytes32 publicManifestHash,
    bytes32 fullManifestHash,
    uint64 validFrom,
    uint64 validUntil
);

event EvidenceStatusChanged(
    bytes32 indexed evidenceId,
    uint8 previousStatus,
    uint8 newStatus,
    bytes32 reasonCode,
    bytes32 supportingManifestHash
);

event EvidenceSuperseded(
    bytes32 indexed previousEvidenceId,
    bytes32 indexed newEvidenceId,
    bytes32 reasonCode
);
```

Events must be sufficient to reconstruct registry history without trusting a mutable database.

## 18. Core invariants

### I-1 — no asset capability

```text
V0 asset supply = 0
V0 mint authority = none
V0 transfer authority = none
```

### I-2 — version monotonicity

For each `(instrumentId, batchId)`:

```text
newVersion = previousVersion + 1
```

No gaps or reuse.

### I-3 — unique active physical lot

At most one non-closed, non-superseded evidence head may own a `physicalLotKey` unless an explicit registry rule documents a split/merge relationship in a future version.

V0 supports no split/merge. Duplicate active keys fail.

### I-4 — signature quorum

`VERIFIED` publication requires valid signatures for every required role and party configured for the instrument.

### I-5 — distinct parties

Required party IDs must be distinct. The manifest must disclose declared common control.

### I-6 — validity window

```text
validFrom <= block.timestamp <= validUntil
validUntil > validFrom
validity duration <= configured maximum
```

Backdated publication beyond a narrow configured tolerance must fail.

### I-7 — append-only history

No evidence record, signature digest, manifest hash, prior signer key, or status transition can be deleted.

### I-8 — dispute precedence

A disputed or suspended record cannot be presented as verified even before expiry.

### I-9 — stale precedence

A record past `validUntil` cannot be presented as currently verified.

### I-10 — synthetic isolation

Synthetic instruments must use a reserved namespace and can never be upgraded in place into a real instrument. A real pilot requires a new instrument ID and deployment/admission decision.

### I-11 — no hidden RMT economics

No RMT-token balance, transfer, fee, bond, reward, governance vote, or treasury address appears in V0.

## 19. Duplicate and conflict detection

The onchain `physicalLotKey` prevents exact committed duplicates inside one registry. Additional offchain detection should compare:

- producer and operator identities;
- inventory-control IDs;
- custody accounts;
- quantity windows;
- storage containers;
- source-document hashes;
- offtake identifiers;
- prior tokenization registries;
- overlapping measurement periods;
- suspiciously similar lot metadata.

The read model should show:

```text
no registry duplicate detected
```

not:

```text
no other claim exists anywhere
```

Global uniqueness cannot be proven from one registry.

## 20. Dispute model

### 20.1 Who may dispute

For the synthetic V0 prototype:

- registry governance;
- any configured evidence party;
- an optional designated test dispute reporter.

Open public dispute submission may be added only if spam/bond/moderation behavior is designed separately.

### 20.2 Dispute record

A dispute must commit:

- reason code;
- supporting manifest hash;
- public URI where safe;
- reporter party/address;
- timestamp;
- affected evidence version;
- whether quantity, title, custody, quality, encumbrance, signer authority, or other scope is challenged.

### 20.3 No silent resolution

A disputed version remains disputed. Resolution requires a new evidence version or closure.

## 21. Reason codes

Use defined `bytes32` constants rather than arbitrary prose for state transitions. Initial conceptual codes:

```text
SIGNER_KEY_COMPROMISED
SIGNER_AUTHORITY_REVOKED
MANIFEST_ERROR
QUANTITY_REVISED
QUALITY_REVISED
CUSTODY_CHANGED
TITLE_CHANGED
ENCUMBRANCE_DISCOVERED
OFFTAKE_DISCOVERED
PRIOR_CLAIM_DISCOVERED
EVIDENCE_EXPIRED
SOURCE_DOCUMENT_WITHDRAWN
SYNTHETIC_TEST_COMPLETE
INSTRUMENT_CLOSED
```

Human explanation belongs in the supporting manifest.

## 22. RMT read model

### 22.1 Top-level status

The UI should show:

- `Synthetic testnet — no value` banner;
- effective evidence status;
- evidence age and expiry;
- exact verification scope;
- missing or private evidence;
- dispute/suspension reason;
- independent-project disclaimer.

### 22.2 Verification facets

Do not compress all evidence into one badge. Show separate facets:

```text
Instrument identity       synthetic / verified / unresolved
Party identity            synthetic / active / revoked
Quantity evidence         signed / stale / disputed / absent
Quality evidence          signed / stale / disputed / absent
Title evidence            synthetic / private commitment / absent
Custody evidence          synthetic / private commitment / absent
Encumbrance evidence      scope-limited / unknown / disputed
Rights                    none in V0
Transferability           none in V0
Redemption                unavailable in V0
Mint authorization        zero in V0
```

### 22.3 Source presentation

Each source row should show:

- document/evidence type;
- issuing party;
- document date;
- validity interval;
- public/private status;
- hash;
- signer scope;
- whether RMT independently reviewed it;
- whether a later version superseded it.

### 22.4 Language rules

Allowed:

- `The configured test custodian signed this synthetic evidence package.`
- `The evidence package expires in 12 days.`
- `The public manifest hash matches the onchain commitment.`
- `No duplicate lot key exists in this registry.`

Prohibited:

- `The helium definitely exists.`
- `RMT guarantees the reserve.`
- `Robinhood verified the asset.`
- `This is legally redeemable.`
- `The lot has no liens anywhere.`
- `The attestor is independent` without documented independence criteria.

## 23. API/read-service proposal

No endpoint is authorized. A future read-only service could expose:

```text
GET /api/rwa/physical-commodities/instruments
GET /api/rwa/physical-commodities/instruments/{instrumentId}
GET /api/rwa/physical-commodities/batches/{batchId}
GET /api/rwa/physical-commodities/evidence/{evidenceId}
GET /api/rwa/physical-commodities/evidence/{evidenceId}/history
GET /api/rwa/physical-commodities/parties/{partyId}
```

Responses must include:

- chain ID;
- registry address;
- deployment/runtime hash;
- block number/time observed;
- effective status and derivation;
- source manifest hash;
- raw event references;
- cache/stale boundary;
- synthetic flag.

The service must not become the authority. Clients should be able to recompute status and hashes from chain data and the public manifest.

## 24. Synthetic fixture plan

### 24.1 Synthetic parties

Create three test-only legal labels:

- `RMT Synthetic Helium Issuer V0`
- `RMT Synthetic Commodity Custodian V0`
- `RMT Synthetic Evidence Attestor V0`

Each uses a separate test key or test multisig.

### 24.2 Synthetic lot

Example only:

```text
commodity:             helium
physical state:        gaseous
quantity:              170,000 scf
quantity standard:     synthetic standard definition
minimum purity:        99.999% synthetic result
region:                synthetic Colorado region
custody:               synthetic stationary storage
encumbrance:           not applicable synthetic
rights:                none
redemption:            none
transfer:              none
mint authorization:    zero
```

The `170,000 scf` demonstration size is a convenient synthetic scale based on publicly discussed tube-trailer magnitudes, but it must not be attributed to a real producer lot or treated as a universal trailer capacity.

### 24.3 Fixture lifecycle

1. Register parties.
2. Configure synthetic instrument.
3. Publish evidence version 1.
4. Verify hashes/signatures.
5. Attempt wrong-chain replay — reject.
6. Attempt wrong-custodian signature — reject.
7. Attempt duplicate lot under another batch ID — reject.
8. Advance/fork time beyond expiry — status becomes stale.
9. Publish version 2 with a revised synthetic quantity.
10. Supersede version 1.
11. Dispute version 2.
12. Close the instrument.

## 25. Adversarial test matrix

### Signature/domain

- [ ] issuer signature from wrong key rejected;
- [ ] custodian signature substituted for attestor rejected;
- [ ] duplicate party filling two required roles rejected;
- [ ] wrong chain ID rejected;
- [ ] wrong verifying contract rejected;
- [ ] wrong schema hash rejected;
- [ ] wrong instrument/batch/lot rejected;
- [ ] malformed ECDSA signature rejected;
- [ ] high-`s` signature rejected where library requires normalization;
- [ ] ERC-1271 invalid magic value rejected;
- [ ] ERC-1271 revert handled safely;
- [ ] signature digest replay rejected;
- [ ] consumed nonce replay rejected.

### Identity/key lifecycle

- [ ] unregistered party rejected;
- [ ] suspended party rejected;
- [ ] revoked party rejected;
- [ ] expired party rejected;
- [ ] new key cannot validate evidence signed before its validity;
- [ ] old key remains verifiable for its historical validity interval;
- [ ] key rotation event fully reconstructs history.

### Version/state

- [ ] version zero rejected if versions start at one;
- [ ] skipped version rejected;
- [ ] reused version rejected;
- [ ] old version cannot overwrite head;
- [ ] invalid transition rejected;
- [ ] disputed record cannot return to verified;
- [ ] suspended record cannot return to verified;
- [ ] superseded record remains queryable;
- [ ] closure prevents new versions unless explicitly configured before closure;
- [ ] expiry derives stale status without a transaction.

### Lot/inventory

- [ ] zero physical-lot key rejected;
- [ ] active duplicate physical-lot key rejected;
- [ ] closed lot reuse policy explicitly tested;
- [ ] changed display name does not evade duplicate detection;
- [ ] changed batch ID does not evade duplicate detection;
- [ ] unsupported split/merge rejected;
- [ ] unknown encumbrance cannot qualify as verified;
- [ ] prior tokenization state blocks verification.

### Manifest

- [ ] zero public manifest hash rejected;
- [ ] zero full manifest hash rejected;
- [ ] same public/full hash rejected if policy requires distinct documents;
- [ ] invalid or non-content-addressed URI rejected by publishing tooling;
- [ ] canonicalization test vectors stable across languages;
- [ ] changed whitespace/key ordering yields same canonical hash where intended;
- [ ] number/string ambiguity rejected;
- [ ] timestamp timezone ambiguity rejected;
- [ ] schema-required field omission rejected before signing.

### Time

- [ ] `validUntil <= validFrom` rejected;
- [ ] already expired package rejected;
- [ ] validity interval above maximum rejected;
- [ ] excessive backdating rejected;
- [ ] future `validFrom` handled as proposed/not-yet-valid;
- [ ] timestamp boundary exactness tested.

### Contract safety

- [ ] no payable entry points;
- [ ] fallback reverts;
- [ ] no external arbitrary call;
- [ ] no delegatecall;
- [ ] no token transfer interfaces;
- [ ] reentrancy from ERC-1271 signer cannot mutate registry incorrectly;
- [ ] oversized signatures/URI inputs bounded;
- [ ] event and storage values agree;
- [ ] role/governance checks fail closed;
- [ ] static analysis passes;
- [ ] full source verification passes.

## 26. Threat model

### T-1 — issuer invents inventory

Mitigation:

- issuer signature alone is insufficient;
- custodian and attestor sign same envelope;
- UI discloses signer scope;
- future real pilot requires source documents and independent checks.

Residual risk:

- collusion among parties;
- false source documents;
- inadequate attestation scope.

### T-2 — same lot backs multiple instruments

Mitigation:

- physical-lot key uniqueness inside registry;
- prior-tokenization field;
- offchain cross-registry search;
- encumbrance evidence.

Residual risk:

- different identifiers for the same physical lot;
- claims outside RMT registry.

### T-3 — evidence stays green after it is stale

Mitigation:

- derived effective status based on `validUntil`;
- UI and API recompute freshness;
- no stored forever-green verification.

### T-4 — compromised signer key

Mitigation:

- key versions and validity intervals;
- suspension/revocation;
- multisig/contract-wallet support;
- short evidence validity;
- new version required after compromise.

Residual risk:

- compromise before detection.

### T-5 — private document hash is marketed as proof

Mitigation:

- exact disclosure language;
- scope fields;
- distinction between `included in signed package` and `independently reviewed`;
- no blanket verified badge.

### T-6 — commercial data leaks

Mitigation:

- redacted public manifest;
- full manifest hash only;
- no exact location/account/policy number onchain;
- pre-publication privacy review.

### T-7 — Robinhood endorsement confusion

Mitigation:

- independent-project disclosure;
- no Robinhood logo without permission;
- no `official`, `approved`, or `partner` language;
- synthetic testnet statement.

### T-8 — evidence registry becomes a shadow token

Mitigation:

- no balances;
- no transferable receipt;
- no ownership mapping;
- no economic rights;
- no price or marketplace;
- synthetic fixtures only.

### T-9 — governance rewrites history

Mitigation:

- append-only versions;
- no deletion;
- immutable contract version;
- explicit governance events;
- source verification;
- old records remain queryable.

### T-10 — oracle theater

Mitigation:

- no price oracle in V0;
- no claim that an oracle proves physical inventory;
- distinguish signed data transport from real-world source competence.

## 27. Future token-standard decision tree

No token standard is admitted by V0.

### Phase 1 — evidence registry

Use a custom evidence registry because the object is an attestation history, not a transferable asset.

### Phase 2 — non-transferable batch receipt, only if needed

A later testnet prototype could consider an ERC-1155-derived receipt because one contract can represent multiple batch IDs. Transfers would need to be disabled or tightly restricted.

Why it may fit:

- per-batch token ID;
- per-batch supply;
- fungible quantities inside one batch;
- standard metadata/events.

Why it is not V0:

- even a non-transferable receipt can be mistaken for ownership;
- legal rights must exist first;
- standard ERC-1155 transfer semantics require deliberate restriction.

Official standard: https://eips.ethereum.org/EIPS/eip-1155

### Phase 3 — permissioned fungible series, only after legal admission

ERC-3643 is a possible pattern if a future instrument must be ERC-20-compatible while enforcing identity and compliance rules.

Why it may fit:

- identity registry;
- transfer compliance checks;
- pause/freeze/recovery capabilities;
- preflight transfer eligibility.

Why it is not automatically correct:

- it is described as a regulated/security-token architecture;
- helium instrument classification is unresolved;
- issuer/agent powers introduce trust and governance risk;
- DEX composability is constrained;
- implementation does not solve physical title/custody.

Official standard: https://eips.ethereum.org/EIPS/eip-3643

### Alternative — ERC-3525 semi-fungible series

ERC-3525's `<ID, SLOT, VALUE>` model could represent a unique entitlement ID with a fungible value inside a common series/slot.

Potential fit:

- unique holder certificate;
- common specification/series slot;
- quantitative value;
- possible batch/rights segmentation.

Limitations:

- less standard wallet/DEX support than ERC-20;
- transfer rules still need legal/compliance design;
- more complex UX;
- no automatic physical evidence.

Official standard: https://eips.ethereum.org/EIPS/eip-3525

### Rejected default — unrestricted ERC-20

Do not begin with an unrestricted ERC-20 because it:

- erases batch differences;
- assumes fungibility before specification/custody are proven;
- defaults to bearer-like transferability;
- creates immediate secondary-market expectations;
- does not encode evidence, title, custody, or redemption;
- may create legal and money-transmission consequences.

## 28. Future reserve/mint invariant

If a later phase issues a real entitlement, the minimum invariant is:

```text
outstanding redeemable units
<= current independently verified unencumbered backing
```

More precisely, for each admitted series/batch:

```text
eligibleBacking
= measuredQuantity
- requiredOperationalHeel
- pendingPhysicalWithdrawals
- unreconciledLosses
- disputedQuantity
- encumberedQuantity
- previouslyAssignedQuantity

mintCap <= eligibleBacking
outstandingSupply <= mintCap
```

V0 sets:

```text
mintCap = 0
outstandingSupply = 0
```

No placeholder mint function should exist in the V0 contract.

## 29. Relationship to the RMT token

V0 has no RMT-token integration.

Specifically:

- no RMT staking;
- no RMT issuer bond;
- no RMT attestor bond;
- no RMT fee credit;
- no RMT governance;
- no RMT reward;
- no helium revenue distribution;
- no helium redemption right for RMT holders.

A future evidence-security bond could be studied only after:

- objective slash conditions exist;
- dispute adjudication is designed;
- securities/commodities/payments analysis is complete;
- economic attacks are modeled;
- RMT-token holders approve no implied commodity claim;
- a separate architecture decision is recorded.

## 30. Relationship to RMT architecture

### Canonical architecture

Any future UI/read-service work must integrate with VNext and the current RWA evidence domain. It must not create a parallel terminal, router, wallet, or market indexer.

### RWA classification

The existing distinction remains:

```text
canonical Robinhood Stock Token RWA
versus
asset merely paired with an RWA
```

A physical-commodity class, if admitted later, must remain separately sourced:

```text
verified physical commodity evidence
```

It must never be inferred from:

- token symbol/name;
- pool existence;
- chain deployment;
- issuer URL;
- Stock Token pairing;
- DEX metadata.

### Current overlap boundary

Draft PR #368 modifies public Robinhood Chain route/layout/footer/sitemap/search files. This research PR must not touch them.

Before a future implementation PR:

1. confirm #368 disposition;
2. inspect active Codex PR changed files;
3. choose a non-overlapping branch/tranche;
4. record architecture admission;
5. keep testnet, token, price, and execution gates off by default.

## 31. Implementation package, if later authorized

A future implementation PR should contain only the smallest coherent tranche:

```text
contracts/src/rwa/RMTCommodityEvidenceRegistryV0.sol
contracts/test/RMTCommodityEvidenceRegistryV0.t.sol
contracts/script/DeployRMTCommodityEvidenceRegistryV0.s.sol
packages/shared/... canonical manifest schema/types
scripts/... synthetic fixture/signing generator
scripts/... hash/signature verification
appropriate focused docs
```

Exact repository paths must be confirmed against current structure before coding.

The first implementation PR should not contain the production RMT UI. Contract/schema proof and UI integration should remain separately reviewable.

## 32. Release gates

### Before code PR

- [ ] explicit owner authorization for testnet evidence-registry implementation;
- [ ] active PR changed-file comparison;
- [ ] no collision with Codex;
- [ ] schema frozen for V0;
- [ ] canonicalization selected;
- [ ] governance/signature model selected;
- [ ] synthetic fixture names reserved;
- [ ] no-token boundary recorded.

### Before testnet deployment

- [ ] complete unit/adversarial tests;
- [ ] full Foundry suite green;
- [ ] static analysis green;
- [ ] secret scan green;
- [ ] deterministic deployment simulation;
- [ ] exact creation/runtime hash evidence;
- [ ] test multisig/party keys explicitly segregated;
- [ ] no real documents or secrets;
- [ ] owner explicitly authorizes gas expenditure and deployment.

### Before public demo

- [ ] source verified on testnet explorer;
- [ ] synthetic banner in every surface;
- [ ] no Robinhood or producer branding misuse;
- [ ] explorer links tested;
- [ ] reproducibility guide complete;
- [ ] limitations and threat model published;
- [ ] no mainnet address or token ticker;
- [ ] no financial/investment claims.

### Before any real physical pilot

- [ ] qualified counsel opinion/work product for exact structure;
- [ ] executed producer/inventory agreement;
- [ ] executed custody/title arrangement;
- [ ] quantity measurement procedure;
- [ ] quality/sampling procedure;
- [ ] encumbrance/title diligence;
- [ ] insurance analysis;
- [ ] AML/KYC/sanctions/transfer policy;
- [ ] tax/accounting analysis;
- [ ] independent attestation engagement;
- [ ] mint/redemption reconciliation design;
- [ ] physical redemption rehearsal;
- [ ] separate owner authorization.

## 33. Current recommendation

Authorize no runtime work yet under this research PR.

The next owner decision should be narrowly framed:

> Should RMT open a separate testnet-only implementation PR for a non-upgradeable, non-payable, non-token `RMTCommodityEvidenceRegistryV0` using synthetic helium evidence, three-party EIP-712/ERC-1271-capable signatures, append-only versions, expiration, dispute/suspension, duplicate-lot prevention, and zero mint authority?

Until that decision is recorded:

- continue research;
- keep PR #369 draft;
- do not deploy;
- do not contact Robinhood as though a prototype exists;
- do not contact physical parties as though inventory will be tokenized;
- do not alter RMT token rights.

## 34. Official technical references

1. Robinhood Chain documentation: https://docs.robinhood.com/chain/
2. Robinhood Chain network configuration: https://docs.robinhood.com/chain/connecting/
3. Robinhood Chain terms: https://docs.robinhood.com/chain/terms-of-service/
4. EIP-712 typed structured data: https://eips.ethereum.org/EIPS/eip-712
5. ERC-1271 contract signature validation: https://eips.ethereum.org/EIPS/eip-1271
6. ERC-5267 EIP-712 domain retrieval: https://eips.ethereum.org/EIPS/eip-5267
7. ERC-165 interface detection: https://eips.ethereum.org/EIPS/eip-165
8. ERC-1155 multi-token standard: https://eips.ethereum.org/EIPS/eip-1155
9. ERC-3525 semi-fungible token: https://eips.ethereum.org/EIPS/eip-3525
10. ERC-3643 regulated transfer architecture: https://eips.ethereum.org/EIPS/eip-3643

## Research integrity notes

- The proposed interface and structures are conceptual and require implementation/security review.
- EIP-712 does not itself provide complete replay protection; V0 adds consumed digests, nonces, domain binding, versions, and validity windows.
- ERC-1271 support increases compatibility with multisigs but introduces an external signature-validation call surface.
- A valid cryptographic signature does not prove the truth or legal sufficiency of the signed statement.
- A content hash proves byte identity, not document authenticity or enforceability.
- A registry duplicate check proves uniqueness only inside that registry and only for the committed identifiers.
- No source cited here authorizes RMT to issue or market a helium instrument.
