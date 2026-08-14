# RMT physical-helium operations, logistics, and unit-economics research

**Status:** RESEARCH — NOT ARCHITECTURE AUTHORITY  
**Date:** 2026-08-14  
**Parent research:** `HELIUM_RWA_RESEARCH_2026-08-14.md` and `HELIUM_RWA_CUSTODY_TITLE_MARKET_STRUCTURE_2026-08-14.md`  
**Scope:** map the physical movement, packaging, custody, quantity conventions, and commercial scale of helium so an eventual RMT commodity instrument cannot promise redemption or fungibility that the real supply chain cannot support.

> This document is research only. It does not authorize a commodity purchase, token issuance, contract deployment, custody arrangement, producer approach, production change, RMT token-rights change, or public partnership/inventory claim. Equipment examples are used to understand logistics and commercial scale; they are not vendor endorsements or quotes.

## Executive conclusion

The physical research reinforces the evidence-first architecture.

A useful onchain denomination can be small, but the **physical delivery unit is not**. A current Colorado producer, Blue Star Helium, states that a standard steel helium tube trailer holds approximately **170,000 standard cubic feet (`170 Mcf`)**. Its March 2026 annual report used a disclosed gaseous-helium range of $350–$600/Mcf to illustrate gross trailer value of roughly $59,500–$102,000; this was a company planning/market illustration, not the confidential price of its current offtake and not an RMT oracle.

This changes the redemption design materially:

```text
ledger denomination ≠ physical delivery denomination
```

If a research unit such as `1 HE-MCF = 1 Mcf` were ever used, a holder of one unit could have a real economic commodity right without necessarily being entitled to demand a dedicated truck delivery of 1 Mcf. The legal terms would need to define aggregation, minimum withdrawal, storage, transfer, handling, and delivery charges honestly.

The strongest physical pilot is therefore likely:

```text
stationary verified inventory
→ commercial custody / auditable account
→ small ledger denominations if useful
→ minimum physical redemption lot
→ scheduled commercial withdrawal or transfer
```

rather than:

```text
one token = one trailer in motion
```

## 1. Real helium supply chain

Primary supplier and equipment sources show a recurring physical flow:

```text
helium-bearing reservoir / feed gas
        ↓
production / gathering
        ↓
separation and purification
        ↓
     ┌─────────────────────┐
     │                     │
     ▼                     ▼
compressed gaseous He   liquefied He
     │                     │
     ▼                     ▼
high-pressure tube      cryogenic ISO
trailer / storage       container / storage
     │                     │
     └──────────┬──────────┘
                ▼
       transfill / distributor
                ↓
      industrial delivery mode
                ↓
            end user
```

Linde describes helium-bearing gas being refined to high-purity specifications and liquefied, then transported in super-insulated ISO containers either directly to customers or to more than 50 helium transfill facilities. At transfills, Linde says liquid helium can be repackaged into tube trailers, dewars, multi-cylinder packs, cylinders, and portable cylinders.

North American Helium similarly describes purified helium being sold as gas or liquid. It states that high-pressure gaseous tube trailers are economically useful for regional shipment, while liquefaction and 40-foot ISO containers are used for long-distance/global transport and broader end-user markets.

### RMT implication

The instrument specification cannot identify only the molecule. It has to identify where in this chain the holder's enforceable right attaches.

Examples:

```text
right to gaseous helium in stationary high-pressure custody
right to liquid helium in named cryogenic storage
right to delivery under a named commercial contract
right to withdraw from a transfill account
```

These are economically and operationally different rights.

Primary sources:
- Linde helium supply/distribution: https://www.linde-gas.com/products-and-services/gases/helium
- North American Helium production/logistics: https://nahelium.com/about-helium/helium-production/
- North American Helium marketing/logistics: https://nahelium.com/marketing-and-logistics/marketing-and-logistics-overview/

## 2. Current Colorado commercial unit: roughly 170 Mcf per standard steel trailer

Blue Star's 2025 annual report, published in March 2026, states:

- a standard steel helium tube trailer holds approximately 170,000 scf (`170 Mscf` / `170 Mcf`);
- using the market metrics in its presentation, a filled trailer represented an illustrative gross value of about $59,500–$102,000 at $350–$600/Mcf.

The report also describes the physical Pinon Canyon process: an amine unit removes CO2, the helium-enriched stream is processed through the Helium Recovery Unit, and refined helium is filled into tube trailers.

Later 2026 public disclosures show the commercial workflow moving from initial spot sales into a three-month offtake covering all Pinon Canyon helium output. The current offtake price and counterparty are confidential.

### Do not misuse the disclosed price range

RMT must not display `$350–$600/Mcf` as a current universal helium price.

It is useful only as evidence that:

1. producers and buyers transact in large commercial physical lots;
2. a full gaseous trailer can represent tens of thousands of dollars of commodity value;
3. logistics, container use, and delivery are material economic components;
4. physical helium pricing is contract-, specification-, location-, and date-dependent.

### Candidate denominator / withdrawal relationship

A 170 Mcf trailer could conceptually correspond to 170 ledger units if a future instrument used 1 Mcf per unit, but there is no requirement that every unit be separately deliverable.

A safer model is:

```text
fungible accounting denomination: 1 Mcf
physical withdrawal minimum: set by actual custodian/distributor contract
```

The withdrawal minimum must be a disclosed legal/commercial term, not a UI assumption.

Primary sources:
- Blue Star Helium 2025 annual report: https://www.bluestarhelium.com/wp-content/uploads/2026/03/61318836.pdf
- Blue Star project overview: https://www.bluestarhelium.com/project/overview/
- Blue Star processing/transport/pricing: https://www.bluestarhelium.com/helium/processing-transport-and-pricing/

## 3. Do not infer gas payload from vessel water volume

High-pressure equipment specifications often publish **water volume** because it describes the geometric/internal vessel capacity used in pressure-vessel engineering.

For example, FIBA's current inventory lists helium trailers with fields such as:

- 9-tube helium trailer, DOT-UN 3169 PSI, `783.9 ft³` H2O volume;
- 10-tube helium trailer, DOT-UN 3188 PSI, `928.4 ft³` H2O volume.

Those H2O values are **not** the same thing as standard cubic feet of deliverable helium.

Actual standard-volume gas payload depends on, among other things:

- fill pressure;
- discharge/heel pressure;
- gas temperature;
- compressibility/real-gas behavior;
- tube geometry;
- operating limits;
- transfer system;
- contractual usable-product definition.

### RMT invariant

Never populate `quantity_backing` from a pressure vessel's water-volume specification.

Quantity backing must come from the actual custody/commercial measurement system and its documented standard conditions.

Primary sources:
- FIBA current inventory: https://www.fibatech.com/inventory/
- FIBA superjumbo tube trailers: https://www.fibatech.com/products/tube-trailers-and-skids/superjumbo-tube-trailers/

## 4. Smaller compressed-gas packages exist, but this does not make retail redemption trivial

FIBA publishes a four-tube swap-load skid with an approximate gas payload of 20,000 standard cubic feet at 2,600 psig.

That product is an industrial compressed-gas logistics example and should not be assumed to be a specific helium custody product for RMT. It does demonstrate that physical gas packages can exist below the ~170 Mcf scale of Blue Star's standard helium trailer.

This is useful for pilot design because commercial withdrawal minimums are a counterparty/equipment decision, not a fixed law of nature.

Possible future arrangements include:

- full tube-trailer lots;
- swap skids / tube modules;
- withdrawals from stationary high-pressure storage;
- transfill into smaller approved packages;
- title transfer within custody without immediate physical movement.

Each changes costs and operating obligations.

Primary source:
- FIBA Swap Load Skid: https://www.fibatech.com/products/tube-trailers-and-skids/swap-load-skid/

## 5. Gaseous helium: simpler state, expensive volume

North American Helium states that high-pressure gaseous helium can be economically shipped regionally in tube trailers, but shipping costs are higher than for liquid helium.

Air Products describes tube trailers as a bulk high-pressure gas delivery method and notes that a trailer can be stored at a customer site, functioning as high-pressure storage through a manifolded vessel system.

FIBA advertises tube trailers for sale and lease and designs equipment around DOT hazardous-material transport requirements.

### Advantages for a first physical RWA pilot

Potentially:

- avoids cryogenic liquid inventory accounting;
- easier conceptual quantity accounting in scf/Mcf;
- compatible with the form in which Blue Star is presently selling Pinon Canyon helium;
- stationary trailer/storage custody can be audited at a fixed location;
- withdrawal can occur through normal industrial-gas transfer systems.

### Drawbacks

- low density means more equipment and freight per unit of helium;
- high-pressure equipment and carrier requirements remain substantial;
- trailer lease/demurrage/use can become part of inventory economics;
- a trailer in transit is a moving custody/title state;
- usable gas can depend on transfer pressure/heel and customer system.

### Research preference

For V0 physical custody, investigate **stationary gaseous inventory** before tokenizing/recording a moving trailer.

Primary sources:
- North American Helium production/logistics: https://nahelium.com/about-helium/helium-production/
- Air Products helium supply modes: https://solution.airproducts.com/helium-supply-issue-solved-0
- FIBA modular trailers: https://www.fibatech.com/products/tube-trailers-and-skids/modular-tube-trailers/

## 6. Liquid helium: much denser logistics, more specialized custody

Large global helium distribution commonly moves helium as a cryogenic liquid.

Gardner Cryogenics states that its helium transport equipment ranges from 3,785 L to 56,781 L and its stationary helium storage range from 12,870 L to 128,000 L, with custom sizes possible.

Its widely used 40-foot ISO liquid-helium container has a nominal capacity of 41,640 L (11,000 gal). Gardner also advertises specific container configurations with hold-time designations up to 45 days and states that the platform is used for road/ocean transport and storage.

North American Helium says it manages six Gardner 175-40 ISO containers and uses them to ship liquid helium to customers worldwide.

### Advantages

- far more helium can move in a given transport footprint than gaseous tube-trailer transport;
- supports long-distance/international logistics;
- common part of the established global bulk-helium supply chain;
- can support transfill into downstream delivery modes.

### Drawbacks

- cryogenic handling is specialized;
- container pressure/thermal condition and hold time matter;
- transfer equipment/procedures matter;
- loss/venting and inventory-accounting rules must be explicit;
- some end users need gas, so downstream vaporization/compression/transfill may be required;
- custody evidence needs to distinguish gross container inventory, usable liquid, gaseous headspace, and any operational loss convention.

### RMT conclusion

Do not make gaseous and liquid helium fungible under one generic token without a conversion and delivery mechanism defined by the actual counterparty agreement.

Primary sources:
- Gardner helium products: https://www.gardnercryo.com/helium-products/
- Gardner company/technology: https://www.gardnercryo.com/about-us/
- Gardner products/solutions: https://www.gardnercryo.com/products-solutions/
- North American Helium marketing/logistics: https://nahelium.com/marketing-and-logistics/marketing-and-logistics-overview/

## 7. Transfill is an important candidate custody boundary

Linde's public helium supply-chain description is strategically important for RMT because it shows a mature intermediary layer between global bulk supply and end-use packaging.

Linde states that liquid helium moves from production in super-insulated ISO containers to more than 50 helium transfill facilities, where it can be repackaged into:

- tube trailers;
- dewars;
- multi-cylinder packs;
- regular cylinders;
- portable cylinders.

This suggests a potentially more practical RWA pilot model than binding the asset directly to a producing well or moving trailer.

### Candidate model

```text
producer / supplier
        ↓
bulk helium delivered into specialist transfill/custody network
        ↓
auditable stationary inventory account
        ↓
RMT evidence commitment + holder entitlement
        ↓
approved withdrawal packaging chosen at redemption
```

### Why this can be better

A transfill/custody operator may already have:

- regulated storage/handling infrastructure;
- quantity accounting;
- quality control;
- multiple delivery-package options;
- transportation interfaces;
- customer accounts;
- certificates of analysis;
- operating procedures for withdrawal.

That does **not** mean Linde, Air Products, Matheson, or any other industrial-gas company will provide third-party token custody or participate with RMT. The research point is that the transfill role exists and may be the physical role to search for among willing specialist counterparties.

Primary source:
- Linde helium: https://www.linde-gas.com/products-and-services/gases/helium

## 8. Existing industrial-gas systems already treat delivery mode as part of the commercial product

Air Products' helium materials describe multiple supply modes:

- dewars for liquid helium;
- ISO containers;
- high-pressure tube trailers;
- distributor/other packaged supply depending region.

Linde similarly says supply mode depends on volume and application, and its electronics business offers bulk gas/liquid delivery and site storage systems.

The RWA instrument therefore needs to carry **delivery-mode obligations** as first-class evidence.

A tokenized title claim that ignores packaging can be economically misleading because the holder may own helium but still owe:

- container lease;
- trailer lease/demurrage;
- transfill;
- delivery freight;
- pressure-transfer service;
- vaporization;
- cryogenic transfer;
- packaging deposits;
- handling;
- minimum order charges.

No fee should be guessed. These need counterparty quotes and contract terms.

Primary sources:
- Air Products helium supply: https://solution.airproducts.com/helium-supply-issue-solved-0
- Linde bulk electronics gas supply: https://www.linde-gas.com/products-and-services/gases/bulk-for-electronics

## 9. Measurement unit must be contract-bound

The symbol `scf` is not sufficiently precise for a trustless instrument unless the reference conditions are pinned.

Federal royalty-reporting rules provide one useful example: gas volumes are reported at a standard pressure base of 14.73 psia and standard temperature of 60°F, and the rule expressly applies the same standards to helium marketed as a separate product.

Other technical standards can use different reference temperatures/pressures. Therefore RMT must not hard-code a universal interpretation merely from the string `scf`.

### Required quantity definition

An eventual legal/product specification should bind:

```text
unit_name
reference_temperature
reference_absolute_pressure
wet_or_dry_basis where relevant
measurement_method
meter_identifier
meter_calibration standard/date
compressibility methodology where required
tolerance
rounding
custody-transfer measurement point
```

If the commercial helium contract itself defines the base conditions, those contract terms control the instrument rather than a generic RMT default.

Primary source:
- 30 CFR §1202.152 / federal royalty gas-volume standard: https://www.law.cornell.edu/cfr/text/30/1202.152
- NIST gas-flow reference-condition warning: https://www.nist.gov/pml/owm/metric-si/unit-conversion/pressure-and-gas-flow-unit-conversions

## 10. A ledger can be fractional without making physical logistics fractional

This distinction is fundamental.

Imagine a verified stationary lot of `170 Mcf` and a ledger denomination of `1 Mcf`.

The system could truthfully show:

```text
eligible physical backing:        170 Mcf
issued entitlement units:         170 x 1 Mcf
minimum physical withdrawal:      20 Mcf, 50 Mcf, 170 Mcf, etc.
                                  (set by real contract; examples only)
```

A holder below the withdrawal minimum could potentially:

- transfer its entitlement if legally permitted;
- aggregate with other eligible entitlements;
- sell through an admitted market;
- request cash/contract settlement only if the legal instrument explicitly provides it;
- wait until it reaches the physical minimum.

RMT must never invent a cash-redemption fallback, pooling mechanism, or aggregation right that the legal documents do not provide.

### UI rule

The UI should distinguish:

```text
Unit: 1 Mcf
Physical withdrawal minimum: 170 Mcf
```

rather than displaying a generic `Redeem` action that implies one-unit delivery.

## 11. Title transfer can occur without moving the molecule

For an RWA, this may be the single most useful physical-market insight.

A commercial asset does not always need to move each time economic ownership changes. If a custodian/legal structure supports it, ownership or beneficial rights can change while the helium remains in the same controlled facility.

This can dramatically reduce:

- unnecessary freight;
- pressure transfer;
- container changes;
- cryogenic handling;
- loss/venting risk;
- reconciliation complexity.

### But it works only if the legal/custody records agree

A token transfer is not enough by itself.

The architecture needs a synchronized authoritative record such as:

```text
onchain transfer requested
        ↓
policy eligibility passes
        ↓
custodian / title registry acknowledges new holder or SPV ledger state
        ↓
evidence update/receipt committed
        ↓
onchain transfer finalized or recognized
```

The exact ordering depends on legal architecture. Atomicity between an EVM transfer and an offchain title ledger is a design problem that must fail closed on disagreement.

## 12. Do not tokenize inventory in transit as the first pilot

A moving trailer/ISO introduces changing operational states:

```text
empty / heel
filling
filled at producer
accepted by carrier
in transit
arrived
customer/custodian accepted
partially withdrawn
returned/exchanged
```

Title and risk of loss can transfer at different points depending on Incoterms/commercial contract.

A first pilot should instead prefer:

- stationary inventory;
- known facility;
- named custodian;
- stable measurement point;
- documented withdrawal authority;
- no ambiguity about carrier possession.

Once that works, an in-transit state can later become an explicit evidence state rather than an invisible operational detail.

## 13. Candidate physical evidence state machine

```text
RAW_PRODUCTION
      ↓
PROCESSED_UNMEASURED
      ↓
MEASURED_PENDING_QUALITY
      ↓
QUALITY_CONFIRMED
      ↓
TITLE_CONFIRMED
      ↓
ENCUMBRANCE_CLEARED
      ↓
CUSTODY_ACKNOWLEDGED
      ↓
ATTESTED_ELIGIBLE
      ↓
ALLOCATED_TO_INSTRUMENT
      ↓
AVAILABLE
      ↓
REDEMPTION_LOCKED
      ↓
WITHDRAWAL_SCHEDULED
      ↓
RELEASED
      ↓
RETIRED
```

Exceptional transitions:

```text
ANY STATE → DISPUTED
ANY VERIFIED STATE → STALE
ANY VERIFIED STATE → ENCUMBERED
ANY VERIFIED STATE → QUANTITY_SHORTFALL
ANY VERIFIED STATE → QUALITY_FAILURE
ANY VERIFIED STATE → LEGAL_HOLD
ANY CUSTODY STATE → CUSTODY_EXCEPTION
```

`DISPUTED`, `STALE`, or `ENCUMBERED` must never remain tradable as if backing were unchanged unless the exact legal architecture and transfer policy explicitly allow it.

## 14. Physical reserve arithmetic must account for unavailable quantity

A simple gross tank/trailer reading is not enough.

Conceptually:

```text
gross measured inventory
- operational heel / unavailable quantity
- quantity already committed to other customers
- quantity under redemption lock
- disputed quantity
- contaminated/off-spec quantity
- legally encumbered quantity
= eligible unencumbered backing
```

The exact deductions are counterparty-specific.

### Instrument invariant

```text
outstanding transferable entitlement
+ entitlement locked for physical release
<= eligible unencumbered backing
```

RMT should expose the components of the reserve calculation rather than publishing only a green `100% backed` badge.

## 15. Quality is part of inventory, not merely token metadata

Linde and other industrial-gas suppliers market helium across different purity/application needs. Gardner advertises purification equipment capable of producing Grade A helium; Blue Star describes further processing from its gaseous output to Grade A or higher-purity product.

Two quantities of helium with materially different purity specifications are not automatically fungible for an industrial buyer.

### Required evidence

- exact contractual purity threshold;
- certificate of analysis / assay identifier;
- sample/measurement timestamp;
- quality-control authority;
- allowed impurity profile if contractually relevant;
- failure/off-spec remedy;
- whether purification is required before delivery.

### RMT rule

A `HE-MCF`-like unit should never combine heterogeneous quality lots under one fungible supply unless the legal/commercial specification makes them deliverable as the same product.

Primary sources:
- Gardner products: https://www.gardnercryo.com/products-solutions/
- Blue Star processing/transport/pricing: https://www.bluestarhelium.com/helium/processing-transport-and-pricing/
- Linde helium: https://www.linde-gas.com/products-and-services/gases/helium

## 16. Custody counterparties should be selected by capability, not brand recognition

The next physical diligence should classify possible counterparties by role:

### A. Producer-side custody

Inventory remains at or adjacent to the producer facility.

Need to know:

- can producer legally segregate/acknowledge third-party inventory?
- does the plant have stationary saleable storage or only fill/exchange trailers?
- how is quantity measured at custody transfer?
- can producer avoid selling/pledging allocated inventory?
- can an independent attestor inspect/reconcile it?

### B. Industrial-gas distributor / transfill custody

Bulk product is delivered to an established downstream operator.

Potential strengths:

- multiple packaging options;
- established customer release processes;
- quality systems;
- warehousing/storage/transport expertise.

Need to know:

- will operator acknowledge inventory held for an SPV/trust/third party?
- can it issue periodic inventory statements?
- can it enforce withdrawal locks?
- does it permit assignment/title transfer without movement?
- what fees/minimums apply?

### C. Dedicated storage / equipment operator

A specialist holds product in stationary high-pressure or cryogenic equipment.

Need to know:

- operator licensing/safety status;
- metering and calibration;
- emergency loss/venting handling;
- insurance;
- release controls;
- equipment lease;
- carrier interfaces.

### Current rule

Do not approach a household-name industrial-gas company with a generic "tokenize helium" pitch. First produce a narrowly scoped custody request describing the legal entity, quantity, state, expected duration, withdrawal profile, attestation cadence, and non-custodial RMT role.

## 17. Equipment vendors are not automatically custodians

FIBA and Gardner are valuable sources because their equipment catalogs reveal how industrial helium is physically stored and moved.

That does **not** mean they:

- custody customer helium;
- provide warehouse-receipt services;
- support tokenized ownership;
- provide independent reserve attestations;
- accept RMT inventory.

The counterparty map must distinguish:

```text
equipment manufacturer
carrier
producer
owner of gas
storage/custody operator
transfill operator
distributor
offtaker
attestor
```

Role confusion is a major RWA risk.

## 18. Unit-economics model: what RMT eventually needs to price

No reliable public source provides a complete current pilot cost stack. The proper next step is to obtain real counterparty/RFQ quotes after a pilot concept has legal approval.

The model should include at least:

### Commodity acquisition

```text
helium price per contractual Mcf
× acquired quantity
```

### Quality / processing

- purification differential;
- assay/certificate;
- compression or liquefaction;
- transfill.

### Container / storage

- tube-trailer lease;
- skid/module lease;
- cryogenic ISO/container lease;
- stationary storage;
- demurrage;
- minimum rental term;
- maintenance/requalification allocation.

### Logistics

- pickup/delivery freight;
- carrier minimum;
- fuel surcharge;
- hazmat-related service cost where applicable;
- return/exchange freight;
- cross-border/ocean cost if liquid international supply is involved.

### Custody / evidence

- custody account fee;
- inventory reconciliation;
- meter/calibration;
- independent attestation;
- title/lien review;
- document storage/evidence service.

### Insurance / legal / compliance

- inventory insurance;
- cargo insurance;
- SPV/trust/admin;
- legal review;
- KYC/AML/sanctions provider;
- audit/accounting/tax.

### Blockchain / RMT

- deployment/security audit only if eventually authorized;
- onchain evidence updates;
- settlement costs;
- market infrastructure;
- no assumption that the RMT token subsidizes a structurally unprofitable commodity operation.

## 19. Break-even logic must be based on redeemable commercial value, not token market cap

The pilot should answer:

```text
landed cost per eligible Mcf
= commodity purchase
+ storage/custody
+ expected loss/heel allocation
+ transport
+ verification
+ insurance
+ legal/compliance
+ operational admin
```

Then compare against:

```text
commercial sale / redemption value per Mcf
```

Do not use:

```text
token FDV
market-cap appreciation
RMT token appreciation
```

as evidence that the physical commodity business is viable.

The RWA should survive even if the associated digital asset never experiences speculative appreciation.

## 20. A 170-Mcf trailer creates a useful pilot scale reference

Using Blue Star's ~170 Mcf standard-trailer example, the research team can model a hypothetical physical pilot without assuming access to Blue Star product.

### Example only — not a proposal or quote

```text
physical lot:               170 Mcf
ledger denomination:          1 Mcf
maximum units:                 170
physical withdrawal min:      TBD by actual custodian
commodity price:              TBD by actual purchase contract
custody term:                 TBD
attestation interval:         TBD
```

This is small enough to reason about operationally but large enough to expose the real issues:

- who buys a ~$tens-of-thousands lot;
- where it sits;
- how ownership is documented;
- what happens if one holder wants 1 Mcf and another wants 100 Mcf;
- who pays freight/container costs;
- what happens to heel/unusable quantity;
- who buys residual inventory;
- how title transfers without moving gas.

The final pilot lot should be chosen by real counterparty economics, not by the 170-Mcf example.

## 21. RMT primary market should probably look more like an RFQ than a DEX launch

The physical data supports the earlier market-structure conclusion.

A credible first market could look like:

```text
seller publishes verified lot
        ↓
product spec + location + quantity + delivery window
        ↓
eligible buyers submit RFQ/bids
        ↓
seller accepts commercial transaction
        ↓
title/custody records update
        ↓
RMT records authenticated clearing observation
```

This produces a real market data point tied to a real lot.

Only later should RMT decide whether that entitlement can be transferred through a secondary onchain venue.

## 22. Market data taxonomy

RMT should show several prices separately if available:

```text
REFERENCE / DISCLOSURE PRICE
- producer presentation or public filing
- not executable

PRIMARY RFQ / AUCTION PRICE
- exact lot/spec/location/date
- executable only for transaction participants

SECONDARY INSTRUMENT PRICE
- price of tokenized/electronic entitlement
- not automatically universal physical helium price

REDEMPTION / LANDED COST
- commodity entitlement + actual delivery/handling terms
```

Do not collapse these into one chart labeled `HELIUM PRICE`.

## 23. Supply mode affects the oracle problem

A hypothetical market for:

```text
99.999% gaseous helium
Colorado custody
1 Mcf accounting unit
170 Mcf withdrawal lot
```

is not interchangeable with:

```text
liquid helium
41,640 L ISO container
international delivery
```

Therefore a generic universal oracle would hide basis differences caused by:

- purity;
- state;
- location;
- container;
- shipment size;
- delivery timing;
- counterparty credit;
- transport;
- transfer restrictions.

RMT's market model should represent those basis attributes rather than pretending they are noise.

## 24. Physical redemption workflow

A future real flow should be closer to:

```text
holder requests withdrawal
        ↓
policy checks holder + destination + minimum lot
        ↓
units become REDemption-LOCKED
        ↓
custodian receives authenticated release instruction
        ↓
quantity / packaging / carrier / date confirmed
        ↓
fees and delivery responsibility confirmed
        ↓
physical custody transfer / delivery occurs
        ↓
custodian produces release evidence
        ↓
onchain units retired/burned
        ↓
reserve ledger reconciles
```

### Failure cases

- holder fails delivery eligibility;
- minimum lot not met;
- carrier unavailable;
- custody discrepancy;
- quality discrepancy;
- storage lien/hold;
- legal/sanctions hold;
- quantity falls below locked units;
- chain transaction succeeds but offchain release fails;
- offchain release occurs but burn transaction is delayed.

Every failure state needs recovery/reconciliation before real issuance.

## 25. The physical asset needs an operations SLA

A token contract cannot promise physical performance by itself.

The commercial documents should eventually define:

- attestation cadence;
- inventory statement cadence;
- custody-reconciliation cadence;
- maximum evidence age;
- withdrawal request processing time;
- delivery scheduling window;
- discrepancy resolution;
- contingency if custodian closes/fails;
- casualty/loss treatment;
- stale/disputed market suspension rules.

RMT can display and enforce evidence status around these terms, but it cannot replace the real contractual obligation.

## 26. Potential pilot location strategy

A Colorado pilot is attractive because:

- RMT's founder is local to Colorado;
- a current producer has demonstrated an active tube-trailer workflow in Las Animas County;
- Colorado has relevant UCC/CER law already identified in the parent research;
- a domestic pilot avoids international customs/ocean logistics in the first tranche.

But geographic convenience is not enough.

A pilot location should be chosen only if a willing commercial counterparty can provide:

- legally clean inventory;
- custody acknowledgment;
- auditable quantity/quality;
- insurance;
- economically viable withdrawal;
- independent attestation;
- counsel-approved transfer/redemption structure.

No current Colorado producer or distributor is assumed willing.

## 27. Counterparty research targets by capability

The next diligence should search for **capabilities**, then companies.

### Producer / seller

Needs:
- saleable produced helium;
- transparent product specification;
- ability to sell an unencumbered lot;
- commercial contract/title documentation.

### Custodian / transfill

Needs:
- physical possession/control;
- account-level inventory reporting;
- withdrawal/release controls;
- multiple packaging/transport options if possible;
- willingness to acknowledge SPV/trust/customer ownership.

### Independent quantity / quality verifier

Needs:
- recognized calibration/inspection methodology;
- independent evidence;
- periodic reconciliation;
- signed/hashed reports suitable for evidence commitment.

### Carrier

Needs:
- appropriate DOT/hazmat authority and equipment;
- custody-transfer documentation;
- scheduling and tracking.

### Insurer

Needs:
- inventory/cargo coverage compatible with ownership structure;
- clear proceeds beneficiary and casualty terms.

### Legal / trust administrator

Needs:
- commodity/title/UCC experience;
- digital-asset securities/payments analysis;
- SPV/trust administration if selected;
- bankruptcy/remoteness analysis.

## 28. Pilot RFQ data sheet — future, not yet to be sent

Before contacting physical operators, RMT should be able to fill this one-page data sheet:

```text
commodity:                 helium
physical state:            gaseous or liquid
purity:                    exact threshold
pilot quantity:            ___ Mcf / ___ L
custody location:          preferred region
custody duration:          ___ days/months
ownership vehicle:         TBD with counsel
inventory segregation:     required method
withdrawal minimum:        ask operator
withdrawal packaging:      ask operator
measurement standard:      ask operator + contract
quality certificate:       required
inventory statement:       cadence
attestation access:        required
insurance:                 ask operator
transfer without movement: ask whether supported
pricing:                   storage / handling / withdrawal / freight
```

The pitch should be `commercial custody + auditable electronic evidence`, not `help us pump a token`.

## 29. New kill criteria from physical operations

Stop or redesign if:

- the pilot cannot separate/identify eligible inventory from the custodian's general obligations;
- the only quantity available is already sold under an offtake;
- measurement base conditions cannot be defined contractually;
- a trailer/equipment water volume is being used as reserve quantity;
- inventory statements cannot distinguish gross quantity from usable/eligible backing;
- the custody operator cannot stop double release or conflicting withdrawal;
- liquid losses/operational handling cannot be reconciled;
- physical delivery minimums make advertised redemption deceptive;
- container/freight/custody fees dominate commodity value at the intended unit size;
- no independent quantity/quality verification is commercially feasible;
- custody/title must move every time a token trades and cannot be synchronized reliably;
- the product works only by hiding logistics costs from holders.

## 30. Exact next research queue

### A. Colorado / regional custody and transfill map

Find operators with actual helium/industrial-gas handling capability in Colorado and adjacent logistics hubs.

For each, determine publicly before any outreach:

- helium modes handled;
- stationary storage;
- tube-trailer handling;
- liquid-helium handling;
- transfill capability;
- customer-owned product/custody possibility;
- published certifications;
- geographic service area.

### B. Measurement / attestation map

Research:

- custody-transfer flow metering;
- pressure/temperature correction;
- calibration chain;
- certificates of analysis;
- independent inspection firms capable of industrial-gas inventory verification.

### C. Real unit economics

After counsel approves outreach, request nonbinding commercial indications for:

- 100–200 Mcf gaseous helium custody;
- trailer/storage lease;
- transfill;
- withdrawal minimum;
- freight;
- independent assay;
- monthly inventory reconciliation;
- insurance.

### D. Compare physical forms

Build decision matrix for:

```text
gaseous stationary custody
vs gaseous trailer custody
vs liquid stationary custody
vs liquid ISO custody
```

Score:

- custody stability;
- measurement complexity;
- loss/heel complexity;
- physical redemption flexibility;
- minimum lot;
- freight efficiency;
- capex/lease burden;
- attestation quality;
- suitability for first U.S. pilot.

## 31. Strongest current pilot thesis

The RMT helium idea is converging on a credible experiment:

> **Acquire or arrange one legally clean, produced helium lot only after counsel and counterparties exist; hold it under specialist stationary custody; prove quantity, quality, title, and encumbrance independently; expose the evidence in RMT; then test primary entitlement and physical redemption before opening secondary transfer.**

That sequence makes the blockchain subordinate to the commodity truth rather than the reverse.

If the physical economics work, RMT gains a model that could extend to other physical commodities. If the economics fail, RMT still gains a stronger RWA evidence standard without exposing users to a misleading token.

## Source register

Primary/company/official sources used in this tranche:

1. Blue Star Helium 2025 Annual Report (Mar 2026) — standard steel trailer ~170,000 scf and disclosed illustrative value range: https://www.bluestarhelium.com/wp-content/uploads/2026/03/61318836.pdf
2. Blue Star Helium project overview — Pinon Canyon processing to tube trailers: https://www.bluestarhelium.com/project/overview/
3. Blue Star Helium processing/transport/pricing: https://www.bluestarhelium.com/helium/processing-transport-and-pricing/
4. Linde — helium production, ISO transport, and 50+ transfill network: https://www.linde-gas.com/products-and-services/gases/helium
5. Linde — bulk electronics gas delivery/storage: https://www.linde-gas.com/products-and-services/gases/bulk-for-electronics
6. North American Helium — production, gaseous versus liquid logistics: https://nahelium.com/about-helium/helium-production/
7. North American Helium — marketing/logistics; 30 composite gas trailers and six Gardner ISO containers: https://nahelium.com/marketing-and-logistics/marketing-and-logistics-overview/
8. Gardner Cryogenics — helium transport/storage capacities and 41,640 L ISO container: https://www.gardnercryo.com/helium-products/
9. Gardner Cryogenics — company/technology/hold-time overview: https://www.gardnercryo.com/about-us/
10. Gardner Cryogenics — helium product configurations: https://www.gardnercryo.com/products-solutions/
11. Air Products — helium supply modes, ISO containers, dewars, tube trailers and customer-site storage: https://solution.airproducts.com/helium-supply-issue-solved-0
12. FIBA — current high-pressure equipment inventory and helium-trailer water-volume examples: https://www.fibatech.com/inventory/
13. FIBA — superjumbo tube-trailer design: https://www.fibatech.com/products/tube-trailers-and-skids/superjumbo-tube-trailers/
14. FIBA — modular tube trailers: https://www.fibatech.com/products/tube-trailers-and-skids/modular-tube-trailers/
15. FIBA — four-tube swap-load skid (~20,000 scf generic gas payload at 2,600 psig): https://www.fibatech.com/products/tube-trailers-and-skids/swap-load-skid/
16. Federal gas-volume reporting standard / 30 CFR §1202.152: https://www.law.cornell.edu/cfr/text/30/1202.152
17. NIST — gas-flow unit conversions/reference-condition caution: https://www.nist.gov/pml/owm/metric-si/unit-conversion/pressure-and-gas-flow-unit-conversions

## Research integrity / Codex coexistence boundary

- Company statements are treated as company statements and examples, not independent price/capacity guarantees.
- Public equipment specifications are not commercial quotes.
- No named supplier, producer, equipment vendor, distributor, or custodian is represented as an RMT partner.
- No inventory access is claimed.
- No current helium price oracle is approved.
- No physical withdrawal minimum is approved.
- No token denomination is approved.
- This file changes no runtime authority, architecture authority, VNext code, contracts, wallets, providers, fees, environment, CI, indexers, or production configuration.
- No merge is authorized by this document.
