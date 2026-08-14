# RMT physical-helium custody, title, and market-structure research

**Status:** RESEARCH — NOT ARCHITECTURE AUTHORITY  
**Date:** 2026-08-14  
**Parent research:** `HELIUM_RWA_RESEARCH_2026-08-14.md`  
**Scope:** determine the safest credible path from a physical-helium commercial transaction to an RMT evidence surface, and identify the legal/operational gates that must be solved before any real helium instrument is issued.

> This document is research only. It is not legal advice and does not authorize a token issuance, contract deployment, production change, custody role, commodity purchase, partnership claim, RMT token-rights change, or public marketing claim. No relationship with Blue Star Helium, Helium One Global, Quantinuum, Renergen, Argonon, Robinhood, or any other named entity is asserted.

## Executive conclusion

The next RMT helium milestone should **not** be a freely transferable ERC-20 and should **not** be an AMM pool.

The strongest near-term architecture is an **evidence-first commodity market surface** that can prove the legal and physical facts of a helium lot before RMT ever treats an instrument as verified.

The regulatory and operational evidence reviewed in this tranche makes the sequencing clearer:

```text
Phase A — evidence only
    physical lot + title + custody + purity + encumbrance + attestation
                         ↓
                 RMT evidence record
                         ↓
                 no token / no transfer

Phase B — primary commercial entitlement
    verified produced inventory
                         ↓
        narrowly defined purchaser entitlement
                         ↓
      non-transferable or tightly permissioned record
                         ↓
                    redemption

Phase C — permissioned secondary transfer
    only after counsel + licensing/counterparty structure
                         ↓
       eligible-wallet transfer controls
                         ↓
           reserve and title reconciliation

Phase D — open secondary market
    only if the exact legal structure permits it
                         ↓
     separately admitted DEX / auction / RFQ venue
```

The critical discovery is that **free transferability is not a neutral technical feature**. FinCEN has already analyzed a closely analogous commodity-backed digital-certificate model and concluded, on those facts, that freely transferable commodity ownership certificates caused the operator to move beyond ordinary commodity brokerage into money-transmitter activity.

That does not decide the legal classification of a future helium product. It does mean RMT should treat open ERC-20 transferability as a late-stage regulatory decision, not a default smart-contract feature.

## 1. Why this changes the V0 recommendation

The parent research correctly identified produced, measured, unencumbered inventory as the best candidate backing.

This tranche adds a more important sequencing rule:

> **First prove the commodity transaction. Then decide whether the electronic record needs to be transferable at all.**

A blockchain record can provide useful provenance, evidence commitments, authorization, and reconciliation without being a permissionless bearer asset.

RMT therefore should not start from:

```text
"How do we launch a helium token?"
```

It should start from:

```text
"What exact legal right exists after a real helium purchase,
who owns the gas,
where is it,
who holds it,
what claims already exist against it,
and what electronic record can truthfully represent that right?"
```

Only after those questions are answered should the instrument type be selected.

## 2. Four candidate operating models

### Model A — RMT evidence-only registry

RMT does not issue the commodity entitlement and does not custody payment or helium.

RMT records and resolves evidence about a third-party transaction or inventory lot:

- producer identity;
- product specification;
- quantity;
- custody;
- title evidence;
- existing offtake/security interests;
- quality certificate;
- insurance where relevant;
- attestation status;
- evidence freshness;
- redemption/delivery terms if an entitlement exists.

The holder's legal rights live entirely in the underlying commercial documents.

**Advantages**

- lowest initial regulatory and operational surface;
- useful to RMT even before a token is justified;
- directly improves the terminal's RWA-verification model;
- no need to pretend a DEX price is a universal helium spot price;
- can be built first with synthetic/test evidence after explicit authorization.

**Limitations**

- no onchain commodity transfer;
- no automatic liquidity;
- commercial counterparties still perform settlement/title transfer offchain.

**Current research preference:** highest-priority first implementation candidate after an explicit architecture decision.

### Model B — direct commodity sale + non-transferable electronic receipt

An eligible purchaser buys a defined physical lot under ordinary commercial documents. A blockchain record acts as evidence/credential/receipt associated with that purchaser.

The record is not freely transferable. Transfer of the underlying commodity requires the commercial parties/custodian to perform a new approved assignment or sale.

Conceptually:

```text
buyer pays seller under commodity contract
            ↓
legal title / delivery right established
            ↓
custodian acknowledges buyer/SPV rights
            ↓
RMT-compatible electronic receipt created
            ↓
receipt can be retired on delivery/redemption
```

This model deserves serious counsel review because it preserves a much closer relationship between the blockchain record and a bona fide commodity purchase rather than creating a parallel freely transferable value rail.

It is **not** automatically exempt from securities, payments, commodities, tax, licensing, or other law.

### Model C — permissioned transferable commodity entitlement

A real commodity entitlement can transfer between eligible participants, but only when policy checks pass.

Potential controls include:

- allowlisted wallets;
- jurisdiction policy;
- identity/KYC status;
- sanctions screening;
- transfer pause/freeze authority defined in legal documents;
- custodian reconciliation before/after transfer;
- holder-of-record synchronization;
- independent reserve cap;
- redemption lock.

This may be the first model that resembles a tokenized RWA market, but it should not be built until specialist counsel identifies the issuer, administrator, exchange/broker, money-transmission, custody, and state-law obligations.

### Model D — freely transferable bearer-like token + AMM

Any wallet can transfer the token and a DEX can trade it permissionlessly.

This is the easiest model technically and the hardest model to justify operationally.

Risks include:

- FinCEN money-transmission/MSB treatment depending on structure;
- inability to enforce purchaser/jurisdiction restrictions;
- legal title record diverging from token holder record;
- anonymous holder presenting for physical delivery;
- sanctions/KYC/redemption conflicts;
- reserve asset becoming economically detached from physical delivery constraints;
- AMM manipulation or thin liquidity being mistaken for physical-helium price discovery;
- retail units becoming economically non-redeemable because physical handling minimums are much larger.

**Current research recommendation:** do not use Model D as V0.

## 3. FinCEN is a direct design constraint

FinCEN ruling FIN-2015-R001 considered a company that:

- brokered commodity purchases;
- bought/sold commodity on its own account;
- held physical commodity in custody;
- issued blockchain-linked digital certificates of custody/ownership; and
- allowed customers to transfer those certificates.

FinCEN distinguished ordinary brokerage where buyer payment goes directly to the seller from the company's freely transferable digital-certificate activity.

On the facts presented, FinCEN concluded that allowing unrestricted transfer of value from one customer's commodity position to another customer or third party went beyond a transfer integral to the bona fide commodity purchase. It treated the freely transferable commodity-backed certificate as convertible virtual currency and the company as a money transmitter.

Critically, FinCEN's footnote states that the same analysis can apply to brokers/dealers in **commodities other than precious metals or real currencies**.

### RMT design consequence

A physical-helium instrument should not be made freely transferable merely because ERC-20 makes that easy.

Before enabling secondary transfers, counsel must answer at minimum:

1. Who accepts value from whom?
2. Who transmits value to whom?
3. Does RMT ever take possession/control of purchaser funds?
4. Does the issuer administer/redesignate the electronic commodity claim?
5. Can one holder transfer its commodity position directly to an unrelated third party?
6. Does the transfer correspond to a bona fide commodity sale or assignment?
7. Who performs AML/KYC/sanctions controls?
8. Is any MSB registration/state money-transmitter licensing required?
9. Can a licensed/regulated third party own these functions instead of RMT?

### Architectural bias

Prefer:

```text
RMT = evidence + market-intelligence + software surface
licensed/commercial counterparty = regulated funds/title/custody role where required
```

over:

```text
RMT = issuer + administrator + custodian + exchange + redeemer + money movement
```

The second architecture concentrates regulatory, operational, solvency, and security risk in RMT.

Primary source:
- FinCEN FIN-2015-R001: https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/application-fincens-regulations-persons

## 4. Securities analysis: a title instrument is possible, but the selling scheme still matters

The SEC/CFTC March 2026 interpretation gives RMT a useful taxonomy without providing a helium-specific safe harbor.

The SEC describes a **digital tool** as a crypto asset that performs a practical function and expressly includes a **title instrument** among the examples of practical functions.

That is important because it shows that recording title-like rights onchain is not conceptually identical to issuing a security.

However, the same interpretation also makes clear that:

- a non-security crypto asset can be offered/sold as part of an investment contract;
- marketing and promises can matter;
- centralized managerial efforts and profit expectations can change the analysis of the transaction;
- a digital security is a security represented onchain; tokenization does not erase the underlying legal character.

### RMT design consequence

Do not market a helium entitlement as:

- passive yield;
- guaranteed appreciation;
- profit from RMT/producer managerial efforts;
- a share of helium-project revenue;
- a share of producer profits;
- an RMT-holder dividend;
- automatic buyback/yield generated by physical helium.

Those features are economically different from a narrow commodity title/delivery instrument and require their own legal analysis.

The existing RMT token should therefore remain separate from helium title/redemption rights unless a future explicit legal/economic decision says otherwise.

Primary sources:
- SEC/CFTC March 2026 interpretation: https://www.sec.gov/rules-regulations/2026/03/s7-2026-09
- SEC small-business summary, updated May 2026: https://www.sec.gov/resources-small-businesses/capital-raising-building-blocks/crypto-assets-federal-securities-laws

## 5. Colorado UCC: blockchain control does not automatically equal ownership of helium

Colorado enacted the UCC 2022 amendments through SB23-090, effective 7 August 2023.

Those amendments include new rules for **controllable electronic records (CERs)** and update secured-transactions rules for digital assets.

This is useful infrastructure for analyzing electronic rights, control, transfer, and priority.

It is not a magic bridge from ERC-20 ownership to physical-helium ownership.

### Counsel must separately map

- whether the blockchain record is itself a CER;
- what rights, if any, are evidenced by the CER;
- whether those rights are rights to goods, payment, delivery, or another contractual claim;
- whether Article 7 document-of-title / warehouse-receipt concepts apply;
- whether a storage/custody operator qualifies for the contemplated document structure;
- Article 9 security interests and competing creditor priority;
- choice-of-law rules;
- location of the goods;
- location/incorporation of issuer/SPV/custodian;
- whether an offchain document remains the authoritative title record;
- how token control and legal ownership remain synchronized;
- what happens in issuer/custodian bankruptcy.

### Key invariant

```text
a wallet controls a token
≠ automatically proves
that the wallet legally owns a particular quantity of helium
```

The legal documents and custody structure have to make the relationship enforceable.

Primary sources:
- Colorado SB23-090: https://leg.colorado.gov/bills/sb23-090
- Uniform Law Commission, UCC 2022 amendments: https://www.uniformlaws.org/acts/ucc

## 6. The physical collateral should be produced inventory, not a story about reserves

V0 should continue to exclude:

- undeveloped acreage;
- estimated geological reserves;
- resource estimates;
- future hoped-for production;
- producer equity value;
- future revenue;
- generic "helium exposure";
- already-contracted/offtaken gas.

Preferred backing remains helium that is:

1. already produced;
2. measured at an agreed standard condition;
3. quality-tested to a stated specification;
4. legally owned by the issuing/SPV/custody structure;
5. unencumbered;
6. identified in custody records;
7. independently attested;
8. available for redemption under explicit commercial terms.

This materially reduces project-development and production-performance risk.

## 7. Offtake is an encumbrance gate

Blue Star's current Pinon Canyon arrangement is a valuable real-world example.

Blue Star announced on 4 June 2026 that its three-month agreement covers **any and all helium production output** from Pinon Canyon. The fixed term expires 31 August 2026 while longer-term negotiations continue.

Its 31 July report again states that the agreement covers all helium output and that longer-term offtake negotiations are continuing.

On 11 August, Blue Star stated that a third tube trailer had been delivered to the offtaker and a fourth was being filled.

### RMT conclusion

Publicly disclosed Pinon Canyon production under that agreement must be treated as **commercially committed**, not as free inventory that RMT could independently represent.

This is not a legal opinion about ownership/title under the confidential contract. It is the only safe product assumption based on the public disclosure.

RMT must never count gas as verified backing when it is already subject to:

- an offtake commitment;
- sale contract;
- lender lien/security interest;
- pledge;
- inventory financing;
- warehouse/custody claim;
- purchase option;
- prior tokenization;
- other conflicting entitlement.

The reserve verifier needs an explicit `encumbrance_status`, not merely a quantity certificate.

Primary sources:
- Blue Star, 4 Jun 2026: https://www.bluestarhelium.com/wp-content/uploads/2026/06/61328251.pdf
- Blue Star, 31 Jul 2026: https://www.bluestarhelium.com/wp-content/uploads/2026/07/61336427.pdf
- Blue Star, 11 Aug 2026: https://www.bluestarhelium.com/wp-content/uploads/2026/08/61338063.pdf

## 8. Product specification cannot stop at "helium"

USGS distinguishes Grade-A helium at 99.997% helium or greater in its commodity reporting.

Commercial contracts may use different or tighter specifications. Renergen's Argonon agreement, for example, specified 99.999% liquid helium.

A future RMT instrument therefore needs immutable/committed product terms rather than a generic symbol.

At minimum:

```text
commodity = helium
purity specification = exact contractual threshold
physical state = gaseous / liquid
quantity unit = exact contract unit
standard conditions = temperature + pressure basis / referenced standard
custody location = named commercial location
container/delivery form = if relevant
redemption point = named delivery/transfer point
```

If two lots differ materially on purity, state, location, or delivery obligation, RMT should not assume they are fungible merely because both contain helium.

Primary source:
- USGS 2026 Mineral Commodity Summaries: https://pubs.usgs.gov/publication/mcs2026

## 9. Transport and custody are not cosmetic metadata

Compressed helium and cryogenic liquid helium are physical hazardous-material/logistics products.

PHMSA materials identify compressed helium as `UN1046`, Division 2.2, and refrigerated liquid helium as `UN1963` in applicable transport contexts.

That does not make helium unusually dangerous compared with many industrial gases; it means the redemption system has real packaging, carrier, pressure/cryogenic, and transport constraints.

### RMT consequence

A retail-looking `Redeem` button must not imply that any wallet holder can receive a tube trailer or cryogenic container at a home address.

Redemption eligibility must be a real operational policy that can include:

- minimum quantity;
- approved commercial delivery location;
- qualified carrier;
- container availability;
- hazmat handling capability;
- scheduling window;
- handling/transport charges;
- proof of recipient eligibility;
- title/risk-of-loss transfer point.

Primary sources:
- PHMSA, compressed helium / UN1046 interpretation: https://www.phmsa.dot.gov/regulations/title49/interp/04-0277
- PHMSA, refrigerated liquid helium / UN1963 interpretation: https://www.phmsa.dot.gov/regulations/title49/interp/22-0129

## 10. Gas in transit is a poor first reserve model

A tube trailer that is being filled, transported, exchanged, or delivered is operational inventory with moving custody and title/risk-of-loss boundaries.

For a first physical pilot, RMT should prefer inventory that can be held under a stable custody/bailment arrangement rather than attempting to keep a bearer token synchronized with a trailer in transit.

### Candidate backing states

```text
PRODUCED_UNVERIFIED
    ↓ quantity + quality + title review
VERIFIED_UNENCUMBERED
    ↓ custody acknowledgment + attestation
ELIGIBLE_FOR_INSTRUMENT
    ↓ issuance
TOKENIZED_OR_RECORDED
    ↓ redemption requested
REDEMPTION_LOCKED
    ↓ title/delivery confirmed
REDEEMED
    ↓
RETIRED / BURNED
```

Exceptional states:

```text
DISPUTED
STALE_ATTESTATION
ENCUMBERED
QUANTITY_SHORTFALL
QUALITY_FAILURE
CUSTODY_FAILURE
LEGAL_HOLD
LOST_OR_RELEASED
```

No exceptional state should silently fall back to `VERIFIED`.

## 11. Physical-custody document package

Before any lot can become `ELIGIBLE_FOR_INSTRUMENT`, the evidence package should be able to prove all of the following.

### 11.1 Commercial/title documents

- purchase/sale agreement;
- invoice/payment evidence when applicable;
- bill of sale or other title evidence;
- exact title-transfer point;
- risk-of-loss allocation;
- governing law;
- dispute process;
- assignment/transfer restrictions.

### 11.2 Custody/bailment documents

- storage or custody agreement;
- identity of physical operator;
- exact location;
- acknowledgment of whose account the helium is held for;
- segregation or auditable fungible-bulk accounting method;
- withdrawal/release authority;
- no-rehypothecation or permitted-encumbrance terms;
- custodian insolvency treatment;
- inventory reporting cadence.

### 11.3 Quantity and quality evidence

- meter/scale/accounting source;
- unit and reference conditions;
- lot/batch identifier;
- assay / certificate of analysis;
- sampling method where applicable;
- timestamp;
- independent verifier identity;
- exception/tolerance policy.

### 11.4 Encumbrance evidence

- contractual representation of no prior sale/offtake;
- lien/security-interest review appropriate to structure;
- inventory-financing disclosure;
- prior token/electronic entitlement search within the system;
- attestor statement covering the exact lot and quantity.

### 11.5 Insurance / casualty treatment

- insured party;
- covered risks;
- deductible;
- proceeds beneficiary;
- treatment if gas is lost/contaminated/released;
- whether token/record holders receive replacement inventory, cash, or another remedy.

No insurance term should be invented by the protocol. It must come from the actual policy and legal structure.

## 12. Three holder-rights structures to compare with counsel

### Structure 1 — direct ownership / undivided interest in identified inventory

Holder owns an interest in a specifically defined commodity lot.

Potential advantage:
- strongest intuitive connection between electronic record and physical property.

Problems to solve:
- fungible/commingled gas accounting;
- fractional co-ownership;
- transfer mechanics;
- creditor priority;
- physical release of partial interests;
- custodian recognition of each holder.

### Structure 2 — bankruptcy-remote SPV/trust owns helium; holder owns beneficial entitlement

A separate entity/trust owns the physical inventory and holders receive defined beneficial/redemption rights.

Potential advantage:
- can centralize custody and reserve management;
- potentially cleaner segregation from producer operating assets.

Problems to solve:
- entity/trust governance;
- securities analysis;
- trustee/custodian obligations;
- bankruptcy remoteness;
- tax/accounting;
- transfer restrictions;
- who controls mint/burn.

### Structure 3 — contractual delivery claim against issuer

Holder owns a contractual right to receive helium rather than direct property ownership in a particular lot.

Potential advantage:
- operationally simpler.

Problems to solve:
- issuer credit risk;
- holder may be only an unsecured creditor absent additional protections;
- securities/investment-contract analysis;
- reserves can appear "backed" while legal ownership remains with issuer;
- insolvency outcome may differ sharply from user expectations.

### Current research preference

Do not choose among these based on smart-contract convenience. Counsel, custodian, insurer, accountant/tax adviser, and actual commodity counterparty need to validate the structure together.

## 13. Evidence schema: deepen the parent model

A future evidence commitment should distinguish **legal right**, **physical inventory**, and **market instrument** instead of collapsing them into one token metadata object.

### Legal-right record

```text
legal_right_id
right_type
issuer_or_obligor
beneficial_owner_model
underlying_title_holder
transferability
assignment_constraints
governing_law
dispute_venue
legal_document_hash
legal_effective_at
legal_expires_at
```

### Physical-lot record

```text
physical_lot_id
producer
commodity
purity_spec
physical_state
quantity
quantity_unit
standard_conditions_hash
location
custodian
container_or_storage_method
quality_evidence_hash
quantity_evidence_hash
custody_ack_hash
encumbrance_attestation_hash
insurance_evidence_hash
verified_at
attestation_expires_at
status
```

### Instrument record

```text
instrument_id
legal_right_id
physical_lot_id
max_authorized_supply
outstanding_supply
locked_for_redemption
retired_supply
transfer_policy_id
redemption_policy_id
issuer_identity
contract_or_record_identity
chain_id
status
```

### Core reconciliation

```text
outstanding_supply
+ locked_for_redemption
<= eligible_unencumbered_backing
```

and independently:

```text
issued_supply
= outstanding_supply
+ locked_for_redemption
+ retired_supply
```

Exact arithmetic/decimals require instrument-specific design.

## 14. Mint authority cannot be the issuer's unsupported assertion

A credible physical RWA should not let the same commercial party:

1. claim the inventory exists;
2. certify its own quantity/quality;
3. certify it is unencumbered;
4. authorize minting;
5. custody the inventory;
6. operate the market; and
7. redeem the token

without independent checks.

A candidate separation is:

```text
producer / seller
       ↓
physical custodian
       ↓
independent quantity/quality evidence
       ↓
legal/title + encumbrance verification
       ↓
attestation authority / trustee
       ↓
limited mint-cap authorization
       ↓
instrument issuer
```

The exact entities may combine roles where law/commercial reality permits, but RMT's evidence model should expose role concentration rather than hide it.

## 15. Price discovery should start with RFQ/auction, not AMM

Helium pricing is commonly private and contract-specific. Blue Star states that helium has traditionally been sold through long-term private contracts and that spot pricing can differ materially. Its current offtake price is confidential.

Therefore an AMM seeded from an arbitrary number would manufacture a token price without proving a physical benchmark.

### Better V0 market model

```text
verified product specification
+ delivery location
+ quantity
+ delivery window
+ eligible counterparties
        ↓
RFQ / sealed or open auction
        ↓
authenticated bids
        ↓
commercial acceptance
        ↓
clearing observation
```

RMT could eventually display the clearing observation as:

```text
SPECIFIC PRODUCT / LOCATION / LOT SIZE / DATE
```

not as a universal `HELIUM/USD` oracle.

### Secondary-market rule

An onchain secondary price is the price of **that legal instrument**, not automatically the cash price of physical helium everywhere.

## 16. Settlement should remain separate from the RMT token

The physical transaction needs a stable commercial settlement asset or ordinary banking settlement appropriate to the counterparty structure.

RMT should not force a helium purchaser to buy the RMT token merely to pay for the commodity.

Possible future RMT roles remain separate research questions:

- issuer/attestor bond;
- terminal fee credit;
- evidence-governance participation;
- verified-counterparty reputation;
- incentive funded from an explicitly approved budget.

None of those should change the helium holder's legal entitlement.

## 17. RMT should not custody the helium in V0

RMT's highest-value role is the **verification and market-intelligence layer**, not becoming an industrial-gas warehouse.

Taking physical custody would add:

- facility/operator risk;
- industrial-gas handling obligations;
- hazmat/logistics operations;
- insurance;
- inventory accounting;
- loss/contamination risk;
- customer delivery operations;
- potentially additional licenses and contractual liabilities.

A specialist industrial-gas storage/custody counterparty is a more credible physical-control role if a pilot advances.

## 18. Blue Star is a case study, not inventory

Blue Star's current public disclosures show a useful end-to-end pattern:

```text
wells
→ gathering system
→ Pinon Canyon processing
→ refined helium gas
→ tube trailer fill
→ scheduled trailer exchange
→ offtaker
```

That is exactly the workflow RMT should understand before designing a physical-instrument lifecycle.

But the current disclosure also says all Pinon Canyon output is covered by the short-term offtake through 31 August 2026.

Therefore:

- do not contact the public as though RMT has Blue Star supply;
- do not create a Blue Star-branded token;
- do not display Blue Star production as token backing;
- do not infer the confidential price;
- do monitor the next offtake structure as a live commercial case;
- if a producer is ever approached, do so only after RMT has a credible one-page commercial/legal pilot proposal rather than a speculative token pitch.

## 19. Market-structure legislation is still moving

As of this research date, the Digital Asset Market CLARITY Act should not be treated as settled law.

The Senate Banking Committee announced on 14 May 2026 that H.R. 3633 advanced from committee by a 15-9 vote and moved toward the Senate floor.

On 22 July 2026, Senator Cynthia Lummis released updated text described as reflecting merged Banking and Agriculture Committee work products and stated that work toward enactment was continuing.

No official source reviewed in this tranche establishes that the updated measure had become enacted law by 14 August 2026.

### RMT consequence

Do not build a production legal architecture around proposed statutory language. Track the bill, but base current legal review on law actually in force plus current SEC/CFTC/FinCEN/state requirements.

Primary sources:
- Senate Banking Committee, 14 May 2026: https://www.banking.senate.gov/newsroom/majority/chairman-scott-senate-banking-committee-advance-clarity-act-in-historic-bipartisan-vote
- Sen. Lummis, 22 Jul 2026 updated text announcement: https://www.lummis.senate.gov/press-releases/lummis-releases-updated-clarity-act-text/

## 20. Recommended RMT admission path

### Gate 0 — research-only (current)

No code, token, commodity purchase, partnership claim, or production change.

Deliverables:

- [x] helium-tokenization prior-art audit;
- [x] initial FinCEN transferability analysis;
- [x] initial SEC/CFTC title-tool / investment-contract boundary;
- [x] Colorado CER/UCC boundary;
- [x] current Colorado producer/offtake case;
- [x] physical hazmat/logistics boundary;
- [ ] exact U.S. commercial helium grade/specification map;
- [ ] storage/custody operator map;
- [ ] tube-trailer/container economics and minimum lot map;
- [ ] independent assay/measurement provider map;
- [ ] insurer/bailment/warehouse structure map;
- [ ] state-by-state money-transmitter analysis;
- [ ] specialist commodity/securities/payments counsel shortlist.

### Gate 1 — evidence-only architecture decision

Requires explicit owner approval.

Build only:

- physical commodity evidence schema;
- synthetic test records;
- evidence freshness;
- conflicting-claim/encumbrance logic;
- reserve-cap arithmetic;
- RWA classification display.

Do **not** issue a token.

### Gate 2 — commercial pilot design

Requires real counterparties and counsel.

Produce:

- term sheet;
- exact product spec;
- holder-rights legal structure;
- custody agreement;
- quantity/quality verification plan;
- encumbrance/lien process;
- insurance treatment;
- payment flow;
- KYC/AML/sanctions flow;
- redemption flow;
- tax/accounting memo;
- regulatory/license matrix.

### Gate 3 — dummy instrument

Only on testnet/synthetic inventory.

Test:

- capped issuance;
- evidence signatures;
- stale/freeze state;
- transfer policy;
- redemption lock;
- burn/retirement;
- over-issuance attacks;
- duplicate-lot attacks;
- attestor compromise;
- conflicting custody updates.

### Gate 4 — tiny real primary issuance

Only after counsel and counterparties sign off.

Prefer:

- one produced lot;
- one location;
- one product specification;
- one custody arrangement;
- a small set of eligible commercial buyers;
- primary sale and redemption before broad secondary trading.

### Gate 5 — secondary market

Secondary transfer is a **new admission**, not an automatic consequence of Gate 4.

It requires:

- transferability legal opinion;
- licensing/MSB analysis;
- eligible-participant policy;
- holder-record synchronization;
- price-discovery method;
- market-abuse controls appropriate to venue;
- reserve/reconciliation proof under transfers;
- proven redemption from an actual holder.

## 21. Kill criteria added by this tranche

Stop before production if:

- the legal title record and token holder can diverge without a reliable reconciliation mechanism;
- a freely transferable token is required for the business case but the issuer/operator cannot support the applicable licensing/compliance obligations;
- the custodian will not acknowledge holder/SPV rights to the exact inventory;
- commingled inventory cannot be reconciled to auditable beneficial ownership;
- gas is already subject to offtake or financing claims that cannot be excluded;
- delivery minimums make advertised redemption economically fictitious;
- the only viable price is a thin token AMM disconnected from physical transactions;
- the structure relies on future production rather than owned produced inventory for the first pilot;
- the issuer can pledge or sell backing outside the instrument without an enforceable control;
- bankruptcy treatment cannot be explained clearly to holders;
- RMT would need to become the physical industrial-gas operator to make the model work;
- the RMT token must be redefined as a helium profit/revenue claim to make demand appear viable.

## 22. Immediate next research tranche

The next research should move from legal architecture into **commercial physical operations**.

### 22.1 Storage/custody operator map

Find U.S. industrial-gas operators that can credibly provide:

- helium storage;
- custody/bailment acknowledgment;
- inventory measurement;
- periodic inventory statements;
- controlled release;
- commercial insurance compatibility;
- willingness to support third-party ownership/SPV inventory.

No operator should be approached as a partner until its actual service model is understood.

### 22.2 Physical unit economics

Determine with primary/industry sources:

- typical tube-trailer usable helium capacity by equipment class;
- fill/lease/exchange economics;
- storage costs;
- minimum commercial delivery quantity;
- compression/liquefaction costs where discoverable;
- freight radius and carrier cost drivers;
- boil-off/storage-loss treatment for liquid helium;
- container deposits/lease obligations;
- assay and attestation cost;
- insurance cost categories.

### 22.3 Measurement standard

Define what `1 Mcf` means contractually:

- reference temperature;
- reference pressure;
- meter calibration;
- allowable tolerance;
- gross vs net usable gas;
- treatment of impurities;
- conversion between gaseous and liquid commercial units.

A smart contract must never invent the standard conditions.

### 22.4 Counterparty shortlist by role

Research categories separately:

```text
producer
industrial-gas distributor/offtaker
storage/custody operator
quantity/quality verifier
insurer
trust/SPV administrator
commodity counsel
securities/payments counsel
licensed digital-asset/market infrastructure
```

The correct pilot may involve several specialist counterparties rather than one vertically integrated RMT entity.

## 23. Strongest current product thesis

The high-value RMT opportunity is becoming more specific:

> **RMT should not try to make helium liquid by pretending a token is the commodity. RMT should make the commodity legible, provable, and tradable only to the extent that the underlying title, custody, reserve, and transfer system is real.**

That is a defensible differentiator from a generic "RWA token."

If successful, the helium work creates a reusable standard for future physical commodity RWAs:

```text
PROVE THE ASSET
→ PROVE THE RIGHTS
→ PROVE CUSTODY
→ PROVE NO DOUBLE CLAIM
→ PROVE THE RESERVE
→ PROVE THE TRANSFER POLICY
→ PROVE REDEMPTION
→ THEN ADMIT MARKET LIQUIDITY
```

## Source register

Primary/official sources used in this tranche:

1. FinCEN — FIN-2015-R001, commodity-backed digital certificates / money transmission: https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/application-fincens-regulations-persons
2. SEC/CFTC — March 2026 crypto-asset interpretation: https://www.sec.gov/rules-regulations/2026/03/s7-2026-09
3. SEC — crypto assets and federal securities laws summary: https://www.sec.gov/resources-small-businesses/capital-raising-building-blocks/crypto-assets-federal-securities-laws
4. Colorado General Assembly — SB23-090 UCC 2022 amendments: https://leg.colorado.gov/bills/sb23-090
5. Uniform Law Commission — UCC / 2022 amendments: https://www.uniformlaws.org/acts/ucc
6. USGS — Mineral Commodity Summaries 2026: https://pubs.usgs.gov/publication/mcs2026
7. PHMSA — compressed helium UN1046: https://www.phmsa.dot.gov/regulations/title49/interp/04-0277
8. PHMSA — refrigerated liquid helium UN1963: https://www.phmsa.dot.gov/regulations/title49/interp/22-0129
9. Blue Star Helium — 4 Jun 2026 offtake: https://www.bluestarhelium.com/wp-content/uploads/2026/06/61328251.pdf
10. Blue Star Helium — 31 Jul 2026 quarterly report: https://www.bluestarhelium.com/wp-content/uploads/2026/07/61336427.pdf
11. Blue Star Helium — 11 Aug 2026 third trailer: https://www.bluestarhelium.com/wp-content/uploads/2026/08/61338063.pdf
12. Senate Banking Committee — CLARITY Act committee action, 14 May 2026: https://www.banking.senate.gov/newsroom/majority/chairman-scott-senate-banking-committee-advance-clarity-act-in-historic-bipartisan-vote
13. Senator Lummis — updated CLARITY Act text, 22 Jul 2026: https://www.lummis.senate.gov/press-releases/lummis-releases-updated-clarity-act-text/

## Research integrity / coexistence boundary

- This document changes no runtime authority.
- It does not modify `ARCHITECTURE_FREEZE.md`, `ACTIVE_SYSTEM_MAP.md`, VNext, contracts, providers, wallets, fees, indexers, CI, production health, or environment configuration.
- It does not authorize a merge.
- It does not claim Blue Star or any other producer has inventory available to RMT.
- Company statements are treated as company statements unless independently corroborated.
- Legal observations are issue-spotting for specialist counsel, not legal conclusions.
- Proposed enums, states, fields, and workflows are conceptual and not approved production interfaces.
