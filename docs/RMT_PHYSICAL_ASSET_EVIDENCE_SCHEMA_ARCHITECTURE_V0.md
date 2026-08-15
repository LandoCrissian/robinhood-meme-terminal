# RMT physical-asset evidence schema architecture V0

**Status:** design analysis; not architecture authority  
**Scope:** commodity-neutral evidence architecture above the synthetic testnet registry  
**Current authorization:** research, tests, documentation, and isolated branch hardening only  
**Explicitly excluded:** mainnet deployment, real inventory admission, token issuance, production UI, legal-right creation, and merge authorization

## Decision

The existing `RMTCommodityEvidenceRegistryV0` is already sufficiently commodity-neutral for its stated synthetic testnet purpose. Helium is represented in fixtures, schema commitments, and demonstration documents; helium-specific fields are not hard-coded into the Solidity evidence envelope.

Do not split V0 into a suite of contracts merely to create architectural symmetry. The current registry has a compact and reviewable security boundary. Prematurely introducing separate schema, policy, party, attestation, and adapter contracts would add cross-contract authorization, version synchronization, upgrade, governance, and failure-mode complexity without improving the synthetic proof.

The justified generalization is therefore an explicit **offchain schema and admission-policy layer** that commits its immutable versions into the existing generic envelope. A future real-asset protocol can implement selected portions onchain only after the operational and legal requirements are proven.

## Current V0 boundary

V0 is permanently:

- synthetic-only;
- bound to Robinhood Chain testnet chain ID `46630`;
- non-token;
- non-custodial;
- non-redeemable;
- non-transferable as a commodity right;
- governed by fixed no-rights and non-transferable policy commitments;
- capable of assigning its stored `Verified` status only to explicitly synthetic evidence using `NotApplicableSynthetic`.

A real-world claim with an unknown, clear, pledged, sold, tokenized, disputed, or otherwise non-synthetic encumbrance state remains `Proposed`. V0 must not be extended to let an issuer select an optimistic enum value and thereby manufacture real-world verification.

## Commodity-neutral core already present

The following current fields and behaviors are commodity-neutral and should remain in the evidence core:

### Identity and versioning

- `schemaHash`
- `instrumentId`
- `seriesId`
- `batchId`
- `physicalLotKey`
- `evidenceVersion`
- monotonic per-batch nonce
- append-only historical versions
- supersession without deletion

### Quantity and measurement

- integer quantity value
- decimal precision
- unit code
- quantity-standard commitment
- stated uncertainty in parts per million
- measurement timestamp
- evidence validity interval

### Evidence classes

- commodity-specification commitment
- public-region commitment
- title-evidence commitment
- custody-evidence commitment
- quality-evidence commitment
- calibration-evidence commitment
- encumbrance-statement commitment and status
- public and full manifest commitments
- content-addressed public-manifest URI commitment
- rights-version commitment
- transfer-policy commitment

### Party and attestation controls

- issuer, custodian, and attestor party identities
- distinct party identifiers and signing accounts
- role-bound EIP-712 signatures
- EOA and ERC-1271 signature support
- party validity windows
- suspension and revocation states
- automatic loss of effective verification when the current quorum is inactive

### Status and auditability

- proposed, verified, disputed, suspended, closed, and superseded stored states
- automatic stale effective state after expiry
- supporting commitments for adverse status changes
- chain-bound and verifying-contract-bound signatures
- replay prevention
- local physical-lot collision prevention

None of these fields assumes helium, gas storage, a metal warehouse, or a particular downstream token standard.

## Helium-specific material belongs above the core

A future immutable `HE-001` schema should define helium-specific requirements such as:

- product specification and accepted purity notation;
- gaseous or liquid state;
- quantity basis and permitted units;
- reference temperature and pressure where volume is used;
- conversion methodology and uncertainty treatment;
- permitted measurement procedures;
- calibration requirements and maximum calibration age;
- container, tube trailer, tank, dewar, or storage identity requirements;
- storage-location disclosure rules;
- sampling and quality-certificate requirements;
- measurement recency and maximum evidence lifetime;
- helium-specific custody, title, logistics, and encumbrance documents;
- whether the lot is stationary, in transit, allocated, commingled, or segregated.

Equivalent modules can later define `XE-001`, `GA-001`, `GE-001`, and other commodity schemas without changing the generic evidence envelope.

## Recommended logical architecture

The following are logical layers, not a direction to deploy six contracts now.

```text
PhysicalAssetEvidenceCore
        +
CommoditySchema
        +
AdmissionPolicy
        +
PartyIdentityAndRoleEvidence
        +
AttestationAndStatus
        +
OptionalDigitalInstrumentAdapter
```

### 1. PhysicalAssetEvidenceCore

The core records identity, quantity, evidence commitments, timestamps, signatures, version history, effective status, disputes, and local lot reservation. The current V0 registry is a synthetic implementation of this layer.

The core proves that named parties signed an exact, address-bound, chain-bound evidence envelope and that the committed record has not been silently replaced. It does **not** prove that the underlying documents are true, that the signers are independent organizations, that title is legally perfected, or that the asset remains physically present after measurement.

### 2. CommoditySchema

A commodity schema defines the required structured fields, units, reference conditions, evidence classes, validation rules, and freshness limits for one commodity and product class.

Each schema version should be immutable and content-addressed. A schema identifier alone is insufficient; the evidence envelope must commit the exact schema document or canonical schema bundle.

A schema should define at minimum:

- commodity family and product form;
- accepted grades/specifications;
- required lot identifiers;
- permitted quantity units and conversion rules;
- measurement method and uncertainty representation;
- quality/assay requirements;
- calibration requirements;
- custody and storage attributes;
- title and encumbrance evidence categories;
- required timestamps;
- public versus restricted fields;
- validation rules and explicit failure behavior.

A generic label such as `verified commodity` must never substitute for commodity-specific completeness.

### 3. AdmissionPolicy

A schema says what the evidence can contain. An admission policy says what must be present and acceptable for a particular use.

An immutable admission-policy version should bind:

- schema version;
- jurisdiction and governing-law scope;
- proposed instrument class;
- required party roles;
- party-independence rules;
- accepted credentials and professional qualifications;
- required evidence classes;
- acceptable document issuers;
- required attestation count and quorum;
- encumbrance treatment;
- maximum age of each evidence class;
- measurement and calibration tolerances;
- custody/segregation requirements;
- dispute and suspension triggers;
- permitted missing, unknown, and not-applicable states;
- exact machine-readable acceptance rules.

For any future real-world pathway, admission must be produced by deterministic policy evaluation or by an explicitly governed attestation over that evaluation. The asset owner must not be able to obtain `Verified` merely by choosing an enum value.

The user-facing semantic should be:

> Evidence package currently satisfies RMT HE-001 admission policy version X.

It should not be:

> Verified helium.

Policy satisfaction describes the exact evidence test performed. It does not silently assert legal ownership, reserve sufficiency, insolvency remoteness, market value, or redemption availability.

### 4. PartyIdentityAndRoleEvidence

An address is a signer, not a legal identity. Distinct addresses do not prove independent organizations or independent beneficial control.

A future party layer should support evidence for:

- legal-entity identity;
- jurisdiction and organizational status;
- role eligibility;
- signing authority;
- beneficial-owner or control-group identifier;
- professional license/accreditation where relevant;
- signer-key version;
- key rotation and revocation;
- validity interval;
- conflicts of interest;
- related-party disclosure;
- credential issuer and credential status.

Admission policy should be capable of rejecting a nominally three-party package where the issuer, custodian, and attestor are controlled by the same organization or beneficial owner.

V0 intentionally does not solve this real-world identity problem. Its separate party identifiers and accounts are necessary testnet controls, not proof of organizational independence.

### 5. AttestationAndStatus

Attestation should be scoped. A custodian may attest possession and location but not legal title. A laboratory may attest purity but not absence of liens. A title specialist may review documents but not current physical quantity.

Future attestations should identify:

- the exact claim set being attested;
- the evidence inspected;
- method and standard used;
- observation or effective time;
- uncertainty and qualifications;
- validity interval;
- exceptions and reservations;
- signer identity and credential;
- revocation or correction mechanism.

A replacement evidence version must not erase a prior dispute. Historical records and adverse-state events must remain independently inspectable.

### 6. OptionalDigitalInstrumentAdapter

The evidence protocol must remain independent from the legal/economic instrument.

An adapter may later associate an admitted evidence record with a separately defined warehouse receipt, contractual entitlement, beneficial interest, debt claim, delivery claim, or other instrument. The adapter cannot create those rights by declaration. It should reference the governing instrument and expose the evidence status required by that instrument's lifecycle.

No token standard should be selected until the holder's actual rights, transfer restrictions, redemption mechanics, eligible-holder rules, jurisdiction, and insolvency treatment are defined.

## Structured manifests versus hashes

Hashes are necessary but insufficient.

A hash can prove that a retrieved document matches the committed bytes. It cannot prove that the document is accurate, current, complete, legally effective, independently issued, or related to the claimed physical lot.

Future schema packages should therefore define a canonical structured representation in addition to storing commitments. The representation should provide:

- deterministic serialization;
- typed fields and units;
- explicit schema and policy versions;
- stable identifiers for parties, lots, instruments, documents, and measurements;
- public and restricted disclosure profiles;
- links between claims and supporting documents;
- field-level provenance;
- validation test vectors;
- content-addressed documents;
- a method for selective disclosure without changing the committed claim set.

A public manifest may expose safe summary data while a full manifest contains restricted commercial, location, identity, or contractual material. Their relationship must be cryptographically defined rather than asserted in prose.

Selective disclosure, Merkle commitments, structured credentials, or zero-knowledge proofs should be introduced only where they solve a concrete confidentiality requirement. They must not obscure missing evidence or convert an unverified offchain assertion into truth.

## Physical-lot identity and double-use prevention

V0 prevents one `physicalLotKey` from being assigned to two batches inside one registry. That control does not prevent:

- another registry from using the same asset;
- another chain from using the same asset;
- an issuer deriving a different key for the same asset;
- double pledging through an offchain agreement;
- movement or substitution after attestation;
- reuse of commingled inventory.

A real protocol needs a lot-identity rule defined by each commodity schema and backed by custodian/issuer obligations. Depending on the commodity, lot identity may incorporate or commit:

- producer lot/batch identifier;
- facility and storage location;
- container or warehouse position;
- custody account or allocation identifier;
- measurement event;
- title-document identifier;
- jurisdictional registry identifier;
- privacy-preserving salt controlled under policy.

The future design must also determine whether lot reservation is enforced through one authoritative registry, interoperable cross-registry attestations, a shared nullifier set, or another mechanism. This is a consequential design fork; local hashing alone is not a complete double-pledging defense.

## Threat-to-control mapping

| Threat | Required control direction |
|---|---|
| Fabricated inventory | independent custody and measurement evidence; qualified attestations; inspectable source documents |
| Duplicate lot or overissuance | schema-defined lot identity; local collision protection; future cross-registry reservation/nullifier; instrument supply reconciliation |
| Forged or substituted document | content-addressed canonical document; issuer provenance; signature/credential validation |
| Stale evidence | per-evidence-class freshness rules; envelope validity; visible stale state |
| Compromised signer | key versioning, revocation, rotation, short validity, emergency suspension |
| Colluding parties | independence/control-group policy; conflicts disclosure; multi-attestor requirements where justified |
| Hidden lien, offtake, sale, or prior tokenization | explicit encumbrance evidence; scoped searches; continuing representations; adverse-state updates |
| Inventory movement after attestation | custody event updates; monitoring cadence; withdrawal/transfer controls; automatic expiry |
| Quantity or unit-conversion attack | schema-pinned unit, reference conditions, method, uncertainty, and conversion rules |
| Quality/specification substitution | lot-bound sampling and quality evidence; immutable specification commitment |
| Chain or contract replay | EIP-712 chain ID and verifying-contract binding |
| Signature or digest replay | consumed digest, monotonic nonce, version ordering |
| Dispute hidden by replacement | append-only history; immutable adverse events; supersession without deletion |
| Administrator compromise | narrow administrative powers, transparent status events, operational controls, future governance analysis |
| Insolvency or custodian bankruptcy | legal structuring, perfected title/security interest, segregation, bailment/SPV analysis; not solvable by Solidity alone |

## Minimal engineering direction for V0

Do now:

1. keep V0 synthetic and testnet-only;
2. keep the current single-registry security boundary;
3. retain exact EIP-712, replay, lot-collision, freshness, dispute, and supersession invariants;
4. keep one deterministic CREATE2 release-preparation mechanism;
5. make CI fail closed on formatting and focused-test failures;
6. document the core/schema/policy distinction;
7. develop offchain schema and policy test vectors before adding real-world state transitions.

Do not add now:

- upgradeable proxies;
- a token or supply interface;
- a digital-instrument adapter;
- a real-world `Verified` path;
- a generic administrator-controlled policy registry;
- cross-contract module calls;
- broad oracle dependencies;
- ZK machinery without a defined confidentiality requirement;
- production UI integration.

## Next schema tranche after V0 is green

The next isolated research/implementation tranche should produce:

1. a canonical commodity-schema document format;
2. an immutable synthetic `HE-001` schema example;
3. a canonical admission-policy document format;
4. a synthetic `HE-001` admission policy with deterministic pass/fail test vectors;
5. explicit claim states: present, absent, unknown, not applicable, stale, disputed, and withheld;
6. party-identity and independence evidence requirements;
7. a cross-registry physical-lot collision design analysis;
8. public/full manifest disclosure rules;
9. a threat model for policy evaluation and credential revocation;
10. no token issuance.

Only after those artifacts are tested should RMT decide whether a future V1 needs an onchain schema registry, onchain admission-policy evaluator, credential verifier, or instrument adapter.

## Migration and semantic versioning

V0's meaning must not be silently expanded. Its constants, synthetic verified path, and no-rights boundary are part of its security model.

A future real-asset implementation should use a new explicit protocol and contract version, with immutable schema and policy identifiers and a documented migration path. Historical V0 records must continue to mean synthetic testnet evidence only.

The protocol's success criterion is not that a hash or badge exists. It is that an independent application can determine exactly:

- which schema and admission policy were applied;
- which claims were made;
- which parties attested which claims;
- which evidence was current at a stated time;
- which evidence was missing, unknown, stale, disputed, suspended, or superseded;
- and what the resulting status does and does not establish.
