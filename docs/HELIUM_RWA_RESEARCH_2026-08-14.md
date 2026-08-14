# RMT Helium RWA research and admission blueprint

**Status:** RESEARCH — NOT ARCHITECTURE AUTHORITY  
**Date:** 2026-08-14  
**Baseline:** `main` at `57955a2a45303ff6953962174a36557f301434a4`  
**Scope:** physical industrial helium as a potential real-world-asset market on Robinhood Chain and a future RMT market surface.

> This document is research only. It does not authorize a token issuance, contract deployment, production environment change, fee change, provider activation, autonomous execution, custody arrangement, public marketing claim, or change to the economic rights of the existing RMT token. It does not claim any relationship with Quantinuum, Blue Star Helium, Helium One Global, Renergen, Argonon, Robinhood, or any other named entity.

## Executive decision

RMT should investigate physical helium as a distinct `physical commodity RWA` class, but it should **not** make the existing RMT token itself "backed by helium" and it should **not** merge physical-helium identity into Robinhood's canonical Stock Token identity.

The clean model is:

```text
physical helium inventory / enforceable commodity entitlement
                    ↓
       independent helium RWA instrument
                    ↓
         RMT evidence + market surface
                    ↓
      Robinhood Chain settlement/execution
```

The existing RMT token, if it is ever used in this system, should remain economically separate from the helium entitlement. Possible future RMT functions include issuer bonding, evidence-verifier bonding, access/fee credits, or governance of evidence standards. None of those functions is admitted by this document.

The helium instrument itself must carry the legally enforceable commodity rights. A working research label such as `HE-MCF` may be used in design documents, but no ticker or token name is reserved or approved.

## 1. First distinction: physical helium is not Helium Network / HNT

The Helium Network and HNT are a DePIN/wireless-network ecosystem. They are not ownership claims on industrial helium gas.

This project is about **physical helium** used in quantum computing, semiconductor fabrication, aerospace, medical imaging, research, welding, and other industrial applications.

RMT must never infer a physical-helium RWA relationship from HNT, Helium Network metadata, a token name, or a ticker collision.

## 2. Demand thesis: quantum computing provides a real industrial use case

Quantinuum publicly documents that helium is used at its Colorado campus as part of its trapped-ion quantum-computing infrastructure. Quantinuum states that it uses helium to keep ion traps very cold because they operate better below 50 Kelvin and describes a recovery loop that moves helium through liquid cooling, gaseous recovery, compression, high-pressure storage, and re-liquefaction.

That matters to this thesis because the demand story is not merely a crypto narrative. There is an observable industrial workflow in which helium is a critical physical input and where recovery/reuse infrastructure is worth substantial operational effort.

Research implication:

- quantum computing should be treated as one demand vertical, not the sole demand thesis;
- physical delivery specification matters because industrial users buy to purity, state, pressure, container, location, and delivery requirements;
- a token that says only "1 helium" is not sufficiently defined to represent a commodity entitlement.

Primary source:
- Quantinuum, "Reduce, Reuse, Recycle, for Helium's Sake": https://www.quantinuum.com/blog/reduce-reuse-recycle-for-heliums-sake

## 3. Prior art exists: Renergen / Argonon

The core idea has precedent and should not be marketed as if nobody has ever attempted to tokenize helium.

In October 2021, Renergen announced a 19-year forward-sale agreement with Argonon Helium US Inc covering up to 100,000 units. Renergen defined each unit as 1,000 standard cubic feet (`1 Mcf`) of 99.999% purity helium in liquid form. The announcement said Argonon would take possession of paid units and use them in an effort to establish a helium spot market. It also identified a digital platform for tracking/exchanging the units.

Argonon's current public website states that 1,000 ARG tokens can be redeemed for 1 Mcf of helium and describes the token as part of a parallel trading economy.

This precedent is strategically useful for three reasons:

1. It proves that a commodity-entitlement/token structure has been attempted specifically for helium.
2. It provides a concrete unit-of-account precedent: Mcf, with purity and physical state explicitly specified.
3. It shows that token creation alone is not the hard problem. RMT still needs to validate current liquidity, redemption history, custody mechanics, title transfer, reserve reconciliation, price discovery, transfer restrictions, and whether the system achieved durable industrial market adoption.

RMT must not copy Argonon's implementation or assume its legal/compliance model is suitable for the United States or Robinhood Chain. The useful output is a failure-mode and design comparison.

Primary sources:
- Renergen, 18 Oct 2021 announcement: https://www.renergen.co.za/wp-content/uploads/2021/10/Helium-Spot-Market-Establishment-Oct-18-JSE-Version-FINAL2-1.pdf
- Argonon: https://argonon-he.com/

## 4. Colorado supply lead: Blue Star Helium / Pinon Canyon

A current Colorado operating case is especially relevant to due diligence.

Blue Star Helium announced in July 2026 that the first production tube trailer had been sold from the Pinon Canyon Plant in Las Animas County, Colorado. On 11 August 2026, it announced delivery of a third trailer, with a fourth being filled.

Blue Star's 4 June 2026 announcement describes an initial three-month offtake agreement with a major U.S. industrial-gases purchaser covering all helium output from Pinon Canyon. The disclosed fixed term expires **31 August 2026**, while wider longer-term offtake negotiations were stated to be ongoing. Counterparty identity and pricing are confidential.

This is a research lead, not a partnership. RMT has no basis to claim inventory access, producer support, supply availability, price access, or willingness by Blue Star or Helium One to participate.

Why this lead matters:

- it provides a live domestic production/custody/delivery workflow to study;
- its tube-trailer delivery model illustrates why location and delivery terms must be first-class asset metadata;
- the short-term offtake boundary provides a useful public event to monitor for how a producer moves from commissioning/spot sales into longer-duration commercial sales;
- a producer already committed under an offtake cannot simply have the same inventory tokenized independently. Title and encumbrance checks must prevent double claims.

Primary sources:
- Blue Star Helium, 4 Jun 2026 offtake announcement: https://www.bluestarhelium.com/wp-content/uploads/2026/06/61328251.pdf
- Blue Star Helium, 14 Jul 2026 first helium sold: https://www.bluestarhelium.com/wp-content/uploads/2026/07/61333758.pdf
- Blue Star Helium, 31 Jul 2026 quarterly activities report: https://www.bluestarhelium.com/wp-content/uploads/2026/07/61336427.pdf
- Blue Star Helium, 11 Aug 2026 third trailer delivered: https://www.bluestarhelium.com/wp-content/uploads/2026/08/61338063.pdf

## 5. Commodity-market evidence source

USGS maintains a dedicated Helium and Rare Gases Statistics and Information program and publishes an annual helium Mineral Commodity Summary. The 2026 Mineral Commodity Summaries are the current federal commodity baseline and include 2025 production data.

RMT should use USGS as an authoritative macro-data input, not as a real-time price oracle. Physical helium pricing is contract-, grade-, form-, delivery-, and geography-sensitive; a production-statistics publication cannot safely set executable token redemption value.

Primary sources:
- USGS helium statistics: https://www.usgs.gov/centers/national-minerals-information-center/helium-and-rare-gases-statistics-and-information
- USGS MCS 2026: https://pubs.usgs.gov/publication/mcs2026
- USGS 2026 helium sheet: https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-helium.pdf

## 6. Recommended instrument model

### 6.1 Do not tokenize a vague story

The token must not represent "exposure to helium" without defining the holder's enforceable rights.

A candidate V0 unit should be expressed as a legally defined quantity with a specification and delivery/custody context. A research example is:

```text
1 HE-MCF
= an enforceable entitlement to 1 Mcf (1,000 standard cubic feet)
  of helium satisfying the instrument's stated product specification,
  held under the named custody/title arrangement,
  at the named delivery or storage location,
  subject to the published redemption terms.
```

`HE-MCF` is a working label only. The actual denomination, purity, gas/liquid state, standard temperature/pressure reference, minimum redemption quantity, delivery unit, and commercial specification must come from an actual producer/offtaker/custodian agreement.

### 6.2 V0 should prefer produced inventory over underground reserves

For the first pilot, RMT should reject claims backed only by estimated underground reserves or future hoped-for production.

Preferred V0 collateral:

- already produced;
- measured;
- quality-tested;
- owned by the issuing/custody structure;
- not already sold, pledged, financed, or committed under an offtake;
- physically identifiable within the operator's inventory controls;
- insured where commercially appropriate;
- subject to a legally enforceable redemption/title framework.

Future production and forward contracts can be researched later as a separate instrument class because they add performance, project, counterparty, and potentially derivatives complexity.

## 7. Reserve/evidence model

A physical-helium token should be impossible to admit into RMT as "verified" based on issuer marketing copy alone.

Minimum batch evidence should include:

| Field | Purpose |
| --- | --- |
| `instrument_id` | Stable RMT evidence identity; not a ticker. |
| `issuer_legal_entity` | Entity legally obligated to token holder. |
| `producer_legal_entity` | Physical producer, if different. |
| `custodian_or_title_holder` | Who controls/holds the physical commodity or document of title. |
| `batch_id` | Physical-accounting batch or inventory lot. |
| `commodity` | Must resolve to physical helium, not HNT or a brand name. |
| `quantity_standard` | Exact unit definition and reference conditions. |
| `quantity_backing` | Verified physical quantity attributable to the instrument. |
| `purity_specification` | Grade/specification required for fungibility. |
| `physical_state` | Gaseous, liquid, or other defined state. |
| `storage_or_delivery_location` | Commercially meaningful location. |
| `container_or_delivery_method` | Tube trailer, cylinder, ISO container, etc. when relevant. |
| `title_evidence` | Evidence of ownership/control. |
| `encumbrance_status` | Offtake, lien, security interest, pledge, or other conflicting claim. |
| `assay_or_quality_evidence` | Independent/product quality evidence. |
| `insurance_evidence` | If required by the custody model. |
| `attestation_issuer` | Party signing reserve evidence. |
| `attestation_timestamp` | Freshness boundary. |
| `attestation_hash` | Immutable document/evidence reference. |
| `mint_cap` | Maximum token units authorized by verified backing. |
| `minted_supply` | Onchain units outstanding. |
| `redeemed_or_burned` | Reconciled retired units. |
| `redemption_minimum` | Physical logistics threshold. |
| `redemption_costs` | Published handling/transport/etc. treatment. |
| `redemption_lead_time` | Operational expectation. |
| `transfer_policy` | Jurisdiction/KYC/eligibility rules independent from DEX route availability. |
| `evidence_status` | `unverified`, `reviewing`, `verified`, `stale`, `disputed`, `suspended`, `redeemed`. |

### Core reserve invariant

At all times:

```text
outstanding redeemable units
<= independently verified, unencumbered backing authorized for tokenization
```

Minting must fail closed when evidence is stale, disputed, incomplete, or no longer proves unencumbered backing.

A later production design should consider whether an independent trustee/custodian controls mint authorization rather than allowing the commercial issuer to self-attest and self-mint.

## 8. Mint / transfer / redemption lifecycle

A candidate lifecycle is:

```text
producer creates physical inventory
→ quality/quantity measurement
→ title + encumbrance verification
→ custody / control established
→ independent reserve attestation
→ mint authorization capped to eligible inventory
→ primary issuance
→ compliant transfer / market activity
→ holder requests physical redemption
→ instrument units are locked
→ physical release/delivery is confirmed
→ redeemed units are burned
→ reserve ledger and outstanding supply reconcile
```

Important failure states:

- if physical inventory is lost, contaminated, released, pledged, or sold outside the instrument, RMT evidence status must immediately become non-verified until reconciliation;
- if an attestation expires, RMT must show `stale` rather than silently carrying forward verified status;
- if delivery has begun but burn confirmation is not final, the unit should not be treated as freely available inventory;
- a token transfer cannot be treated as legal title transfer unless the legal documents make that result explicit.

## 9. Price discovery: do not invent a helium oracle

A physical-helium market should not begin with a fabricated universal USD/helium spot price.

The Renergen/Argonon precedent itself was motivated by the historical lack of a transparent spot price per Mcf. Current producers also commonly use confidential commercial terms.

A safer RMT research path is:

1. preserve the distinction between **reference data** and **executable price**;
2. model actual product specification and delivery location;
3. investigate RFQ/auction-based primary price discovery for eligible counterparties;
4. store authenticated clearing observations with specification, location, size, and timestamp;
5. admit secondary AMM/DEX liquidity only when transfer restrictions, redemption rights, pricing risk, and market-maker obligations are understood.

Potential future price surfaces:

```text
HE / Grade X / Colorado / gaseous / tube-trailer / prompt delivery
HE / Grade X / Gulf Coast / liquid / prompt delivery
```

Those are examples of a market-data taxonomy, not approved products.

V0 should not launch futures, perpetuals, leverage, synthetic exposure, or uncollateralized forward instruments.

## 10. RMT token relationship

### Rejected default

Do not make the existing RMT token itself a direct claim on helium inventory, producer revenue, helium appreciation, or redemption proceeds through an undocumented retrofit.

That would:

- change the economic meaning of the existing asset;
- entangle RMT holders with the issuer/custody/redemption structure;
- create difficult securities/commodities/money-transmission questions;
- make the RMT market dependent on physical commodity operations;
- complicate every current RMT execution and treasury policy.

### Candidate future utility, only after separate admission

RMT may later investigate one or more of these functions:

- **issuer verification bond:** an issuer posts RMT that can be subject to a disclosed dispute/slashing process;
- **attestor bond:** approved evidence providers stake against objectively defined evidence failures;
- **access/fee credit:** RMT provides terminal benefits without creating a commodity entitlement;
- **evidence-governance utility:** constrained governance over non-economic evidence standards, not the ability to vote physical reserves into existence;
- **liquidity incentive:** only if legally permitted and economically sustainable, and never as a substitute for real industrial demand.

No candidate is approved here. The critical separation is:

```text
helium instrument = commodity/title/redemption rights
RMT = potential protocol utility / evidence-security role
```

## 11. RMT RWA classification must expand carefully

Current RMT architecture correctly distinguishes a canonical Robinhood Stock Token from an unrelated token merely paired with an RWA.

A future physical-commodity path should add a third identity only through explicit architecture admission:

```text
canonical_stock_rwa
verified_physical_commodity_rwa
rwa_paired
unverified_rwa_claim
```

These names are conceptual only and are not approved code enums.

### Required invariant

**Pool existence, token symbol, token name, issuer website, or pairing with a Stock Token must never establish physical-commodity RWA identity.**

Physical-commodity identity must resolve through a separate evidence registry with issuer, legal rights, custody, reserve, attestation, and policy provenance.

Robinhood's official Stock Token contract registry remains authoritative only for Robinhood Stock Tokens. A helium token deployed on Robinhood Chain would not become a Robinhood Stock Token merely because it is an ERC-20 on chain.

Primary Robinhood sources:
- Robinhood Chain mainnet overview: https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/
- Robinhood Chain canonical token contracts: https://docs.robinhood.com/chain/contracts/

## 12. Legal/regulatory work is an admission gate, not a disclaimer

No production helium instrument should be created until specialist U.S. commodities/securities/payments counsel maps the exact rights and workflow.

### 12.1 Securities analysis

The SEC's March 2026 interpretation makes clear that crypto-asset classification depends on characteristics, rights, and the transaction/representations around an asset; a non-security crypto asset can still be offered or sold subject to an investment contract. A helium entitlement therefore cannot be classified safely from the token's name or ERC-20 implementation.

Required legal output:

- classification of the instrument itself;
- classification of primary issuance;
- effect of marketing/promises;
- secondary-transfer treatment;
- broker/dealer/exchange/ATS implications if applicable;
- eligible jurisdictions and purchaser restrictions.

Primary source:
- SEC/CFTC March 2026 interpretation: https://www.sec.gov/rules-regulations/2026/03/s7-2026-09

### 12.2 Commodity / derivatives analysis

The CFTC joined the March 2026 interpretation and stated that certain non-security crypto assets can meet the Commodity Exchange Act definition of commodity. Separately, physical-helium forwards, futures, swaps, options, leverage, or synthetic price exposure can create materially different regulatory questions from a physically backed spot entitlement.

V0 therefore remains deliberately limited to researching produced, physically backed spot inventory and redemption.

Primary source:
- CFTC release 9198-26: https://www.cftc.gov/PressRoom/PressReleases/9198-26

### 12.3 FinCEN / money-transmission analysis

FinCEN has an older but directly relevant administrative ruling involving freely transferable digital certificates of ownership of precious metals. In the facts of that ruling, FinCEN concluded the company went beyond ordinary commodity brokerage and acted as a convertible-virtual-currency administrator / money transmitter.

That ruling is not a legal conclusion about a helium product. It is a warning that a freely transferable commodity-backed digital certificate can trigger money-transmission/BSA analysis depending on structure.

Required legal output:

- issuer versus broker/dealer role;
- custody and redemption funds flow;
- transferability model;
- MSB/money-transmitter analysis;
- AML/KYC/sanctions obligations;
- state money-transmission analysis where applicable.

Primary source:
- FinCEN administrative ruling: https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/application-fincens-regulations-persons

### 12.4 Property/title / UCC analysis

Colorado enacted the 2022 UCC amendments in 2023, including provisions addressing controllable electronic records and property rights in certain intangible digital assets. That may be relevant to structuring electronic records and control, but it does **not** by itself establish that an ERC-20 is a warehouse receipt, transfers title to helium, or solves securities/commodities/payments law.

Counsel should separately analyze:

- Article 7 / documents of title and warehouse-receipt concepts where applicable;
- Article 9 security interests and perfection;
- Article 12 controllable electronic records;
- governing law for the physical inventory and custodian;
- title passage on token transfer;
- bankruptcy remoteness and treatment of customer assets;
- liens/offtake/secured-creditor priority.

Primary source:
- Colorado SB23-090: https://leg.colorado.gov/bills/sb23-090

## 13. Candidate V0 technical architecture

No implementation is authorized, but the eventual architecture should separate evidence from execution.

```text
                    OFFCHAIN PHYSICAL / LEGAL DOMAIN

 producer ── quantity/quality ──► custodian/title structure
                                    │
                                    ├── title evidence
                                    ├── encumbrance evidence
                                    ├── quality evidence
                                    └── reserve attestation
                                             │
                                             ▼
                                signed evidence package
                                             │
─────────────────────────────────────────────┼─────────────────────────
                                             │
                                      ONCHAIN DOMAIN
                                             ▼
                                   evidence commitment
                                             │
                                     mint-cap authority
                                             │
                                             ▼
                                     helium instrument
                                             │
                            transfer / lock / redemption burn
                                             │
─────────────────────────────────────────────┼─────────────────────────
                                             │
                                       RMT DOMAIN
                                             ▼
                             read-only evidence resolution
                                  /        |        \
                           identity      risk       market
                           status        status     discovery
                                             │
                         execution only if separately admitted
```

### Separation of authority

- The market/indexer must not invent reserve status.
- The RMT UI must not upgrade an issuer claim to verified based on a URL.
- A quote provider must not determine legal eligibility.
- Legal/policy eligibility must not be inferred from route availability.
- A DEX pool must not determine RWA identity.
- Reserve attestation must not authorize arbitrary contract calls.
- RMT must not custody physical helium unless a completely separate legal/operational decision explicitly creates that role.

## 14. Admission gates

### Phase 0 — research (current)

- [x] Separate physical helium from HNT/Helium Network.
- [x] Identify helium-tokenization precedent.
- [x] Identify a current Colorado production case.
- [x] Confirm quantum-computing industrial use from a primary source.
- [x] Identify current Robinhood Chain RWA/Stock Token boundary.
- [x] Identify initial U.S. securities, CFTC, FinCEN, and Colorado-UCC research surfaces.
- [x] Audit Argonon's current contract/token and the public evidence available for custody/redemption/liquidity/transfer/legal design; unresolved private/offchain facts remain explicit unknowns.
- [x] Build an initial physical-helium supply, packaging, transport, custody-boundary, and price-source map; real pilot quotes and exact contract specifications remain required.
- [ ] Identify qualified commodity/custody counsel.
- [ ] Identify willing producer, industrial-gas distributor, custodian, warehouse/document-of-title, insurer, and independent attestor roles.

Completed research tranches are recorded in:

- `HELIUM_RWA_ARGONON_FORENSIC_2026-08-14.md`
- `HELIUM_RWA_CUSTODY_TITLE_MARKET_STRUCTURE_2026-08-14.md`
- `HELIUM_RWA_PHYSICAL_OPERATIONS_AND_UNIT_ECONOMICS_2026-08-14.md`

### Phase 1 — evidence schema / read-only prototype

Only after explicit owner authorization:

- implement a separate physical-commodity evidence type;
- no token issuance;
- no RMT token-rights changes;
- no public "verified helium" label without real evidence;
- testnet/dummy evidence only;
- adversarial tests for stale, conflicting, forged, duplicate, over-minted, and encumbered inventory claims.

### Phase 2 — dummy testnet mint/burn prototype

Only after legal architecture exists in draft and the evidence model survives review:

- testnet only;
- synthetic/dummy inventory;
- capped minting;
- redemption lock/burn state machine;
- signed evidence updates;
- no real funds or physical commodity rights.

### Phase 3 — small physical pilot

Only after legal counsel, counterparty agreements, insurance/custody, transfer policy, KYC/AML, independent attestation, and owner approval:

- one narrowly specified physical batch;
- deliberately small liability surface;
- primary issuance/redemption before broad secondary liquidity;
- full reserve-to-supply reconciliation.

### Phase 4 — market admission

Only after successful physical redemption evidence:

- qualified price discovery/RFQ/auction as appropriate;
- separately admitted secondary liquidity;
- policy-aware RMT display;
- explicit source, age, rights, location, purity, redemption, and restriction disclosures.

## 15. Kill criteria

RMT should stop the project rather than force a token launch if any of these remain unresolved:

- no legally enforceable holder right to physical inventory or redemption;
- issuer can mint outside an independently verified reserve cap;
- title can be double-pledged or conflicts cannot be detected;
- existing offtake/security interests make tokenized inventory unavailable;
- custody or bankruptcy treatment leaves holders as an unclear unsecured claim;
- no credible independent quantity/quality attestation;
- physical redemption cannot be operationalized;
- transfer restrictions cannot be enforced where required;
- storage, handling, transport, insurance, or minimum-lot economics make retail-sized redemption misleading;
- no credible industrial buyers, market makers, or primary counterparties exist;
- a viable product would require unapproved futures/synthetic/leverage architecture;
- public marketing would need to overstate reserve, partnership, liquidity, or price claims.

## 16. Immediate research queue

### A. Argonon forensic review — initial public-source tranche complete

Completed in `HELIUM_RWA_ARGONON_FORENSIC_2026-08-14.md`:

- token contract / chain / public issuer evidence;
- supply and public holder/liquidity evidence;
- public redemption claims and documentation gaps;
- exchange/liquidity history;
- public transfer architecture;
- distinction between onchain token mechanics and offchain reserve/redemption controls.

Still requires non-public or counterparty evidence before any stronger conclusion:

- independently documented physical redemptions;
- current custody/title records;
- current reserve reconciliation;
- private legal/commercial agreements.

### B. Colorado / U.S. physical supply-chain map — initial tranche complete

Mapped in `HELIUM_RWA_PHYSICAL_OPERATIONS_AND_UNIT_ECONOMICS_2026-08-14.md`:

```text
well / raw gas
→ processing
→ purified helium
→ compression / liquefaction
→ tube trailer / container
→ transfill / custody
→ industrial delivery
→ end user
```

The remaining work is counterparty-specific:

- exact measurement/custody-transfer standards;
- storage and trailer economics;
- minimum commercial withdrawal;
- insurance;
- auditable third-party custody;
- independent attestation;
- real nonbinding RFQ quotes after counsel approves outreach.

### C. Market data / price discovery

Build a hierarchy:

1. government supply/demand statistics;
2. producer public disclosures;
3. industrial-gas / specialist price assessments where licensable;
4. authenticated RMT RFQ/auction observations;
5. secondary onchain market prices, clearly labeled as token-market prices rather than universal physical-helium spot prices.

### D. Legal structure comparison — initial issue-spotting complete

`HELIUM_RWA_CUSTODY_TITLE_MARKET_STRUCTURE_2026-08-14.md` compares:

- evidence-only registry;
- direct commodity sale plus non-transferable electronic receipt;
- permissioned transferable entitlement;
- freely transferable bearer-like token / AMM;
- direct-title, SPV/trust, and contractual-delivery-claim holder-right structures.

The research recommendation is to start with evidence-only architecture and treat secondary transferability as a separate legal/product admission.

Specialist counsel still must evaluate holder rights, insolvency treatment, transferability, KYC, custody, mint authority, redemption, tax/accounting, commodity/derivatives treatment, securities analysis, and money transmission.

## 17. Codex coexistence rule

This research must not compete with current Codex terminal work.

For this research track:

- use a dedicated non-`codex/` branch;
- make documentation-only commits until a later explicit architecture decision;
- do not edit VNext runtime, wallet, execution, provider, fee, environment, contract, indexer, or production-health files;
- do not modify `ARCHITECTURE_FREEZE.md` or `ACTIVE_SYSTEM_MAP.md` merely because this research looks promising;
- open only a draft PR;
- do not merge automatically;
- rebase/reconcile later if main moves;
- before any future code PR, compare changed files against active Codex branches/PRs and choose a non-overlapping tranche.

## 18. Current recommendation

Proceed with research aggressively, but keep production untouched.

The most defensible product thesis is not "RMT launched a helium token." It is:

> RMT can become an evidence-first market surface where a physical commodity is admitted only when the terminal can prove what the instrument represents, who owes the obligation, where the backing sits, whether it is unencumbered, how it can be redeemed, how fresh the evidence is, and what transfer restrictions apply.

If helium passes those gates, it becomes a high-value test case for a broader `verified_physical_commodity_rwa` framework. If it fails them, the research should improve RMT's RWA verification model without creating a misleading asset.

## Source register

Primary/official sources used in this initial pass:

1. Quantinuum — helium recovery and quantum-computing use: https://www.quantinuum.com/blog/reduce-reuse-recycle-for-heliums-sake
2. USGS — Helium and Rare Gases Statistics and Information: https://www.usgs.gov/centers/national-minerals-information-center/helium-and-rare-gases-statistics-and-information
3. USGS — Mineral Commodity Summaries 2026: https://pubs.usgs.gov/publication/mcs2026
4. USGS — 2026 helium data sheet: https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-helium.pdf
5. Renergen — 18 Oct 2021 helium/Argonon agreement: https://www.renergen.co.za/wp-content/uploads/2021/10/Helium-Spot-Market-Establishment-Oct-18-JSE-Version-FINAL2-1.pdf
6. Argonon — current public helium-token site: https://argonon-he.com/
7. Blue Star Helium — 4 Jun 2026 offtake: https://www.bluestarhelium.com/wp-content/uploads/2026/06/61328251.pdf
8. Blue Star Helium — 14 Jul 2026 first sale: https://www.bluestarhelium.com/wp-content/uploads/2026/07/61333758.pdf
9. Blue Star Helium — 31 Jul 2026 quarterly report: https://www.bluestarhelium.com/wp-content/uploads/2026/07/61336427.pdf
10. Blue Star Helium — 11 Aug 2026 delivery update: https://www.bluestarhelium.com/wp-content/uploads/2026/08/61338063.pdf
11. SEC/CFTC — March 2026 crypto-asset interpretation: https://www.sec.gov/rules-regulations/2026/03/s7-2026-09
12. CFTC — Release 9198-26: https://www.cftc.gov/PressRoom/PressReleases/9198-26
13. FinCEN — digital certificates of ownership of precious metals ruling: https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/application-fincens-regulations-persons
14. Colorado General Assembly — SB23-090 / UCC 2022 amendments: https://leg.colorado.gov/bills/sb23-090
15. Robinhood — Robinhood Chain mainnet overview: https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/
16. Robinhood Chain docs — canonical token contracts: https://docs.robinhood.com/chain/contracts/

## Research integrity notes

- Company statements about market conditions, production outlook, reserves, demand, or compliance are treated as company claims unless independently corroborated.
- No public source found in this initial pass is treated as proof that a current producer has unencumbered inventory available for RMT.
- No source is treated as legal advice.
- No token contract, issuer, custodian, attestor, or oracle is approved by this document.