# RMT Helium RWA — Robinhood alignment and visibility plan

**Status:** RESEARCH / GO-TO-MARKET DESIGN — NOT ARCHITECTURE AUTHORITY  
**Date:** 2026-08-14  
**Repository baseline:** `main` at `57955a2a45303ff6953962174a36557f301434a4`  
**Research branch:** `research/helium-rwa-2026-08-14`  
**Working public product label:** `RMT Helium Reserve Observatory`  

> This document does not authorize a token issuance, contract deployment, production route, commodity purchase, producer outreach, custodian outreach, legal claim, partnership claim, public endorsement claim, or change to the economic rights of the existing RMT token. RMT is an independent third-party project. Robinhood, Blue Star Helium, Helium One Global, Tumbleweed Midstream, Quantinuum, CEESI, Atlantic Analytical, and every other organization named here have not approved, endorsed, partnered with, or supplied inventory to this research.

## Executive decision

The path most likely to earn serious attention from Robinhood Chain, Arbitrum, RWA builders, physical-commodity operators, and technical media is **not** to announce a helium coin.

The credible wedge is to build the first open, evidence-first physical-helium admission layer on Robinhood Chain:

```text
real-world claim
→ machine-readable evidence
→ independent signatures
→ freshness / dispute / encumbrance state
→ public testnet verification
→ RMT evidence surface
→ only later: legally admitted entitlement and market activity
```

The first public artifact should be a testnet **reserve observatory**, not a tradable instrument. It should prove that RMT can distinguish:

- a producer announcement from actual token backing;
- produced inventory from underground reserves or expected future production;
- equipment capacity from measured commodity quantity;
- issuer marketing from title evidence;
- physical custody from wallet custody;
- an unencumbered lot from inventory already sold, pledged, financed, or committed under an offtake;
- current evidence from stale evidence;
- a verified physical-commodity claim from a token merely using an RWA name;
- Robinhood Stock Tokens from independent third-party physical-commodity instruments;
- route availability from legal or jurisdictional eligibility.

If RMT can demonstrate those boundaries on Robinhood Chain testnet, it will be presenting infrastructure that fits the chain's stated RWA mission while solving a problem that ordinary DEX interfaces do not solve.

There is no guarantee Robinhood will feature, contact, fund, endorse, or integrate RMT. The goal is to make the work technically strong enough that the project is worth reviewing.

## 1. Why this is aligned with Robinhood Chain

Robinhood describes Robinhood Chain as:

- permissionless and EVM-compatible;
- open to third-party applications and smart-contract deployments;
- purpose-built for financial services and real-world assets;
- intended to support programmable, self-custodied, continuously accessible assets;
- supported by a developer testnet and standard Ethereum tooling;
- part of a builder ecosystem that has included the 2026 Arbitrum Open House program.

Official sources:

- Robinhood Chain mainnet overview: https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/
- Robinhood Chain mainnet announcement: https://robinhood.com/us/en/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/
- Robinhood Chain developer documentation: https://docs.robinhood.com/chain/
- Robinhood Chain testnet announcement: https://robinhood.com/us/en/newsroom/robinhood-chain-launches-public-testnet/
- Arbitrum announcement: https://blog.arbitrum.io/robinhood-chain-testnet/
- Arbitrum Open House: https://openhouse.arbitrum.io/

This alignment is architectural, not relational. Permissionless deployment does not imply Robinhood review, approval, partnership, or endorsement.

### 1.1 Why Robinhood's existing Stock Token model strengthens the case for evidence discipline

Robinhood's own disclosures distinguish economic exposure from legal or beneficial ownership of an underlying security and impose jurisdictional restrictions on Stock Tokens.

That is an important design lesson for physical helium:

> The token name, chain, pool, and price do not define the holder's legal rights. The governing instrument and evidence do.

RMT should make those rights and restrictions visible rather than flattening every asset into a generic ticker.

### 1.2 Why helium is a useful flagship commodity

Helium is an unusually strong test case because it combines:

- observable industrial demand in quantum computing, semiconductors, medical imaging, aerospace, research, and advanced manufacturing;
- difficult production, purification, liquefaction, storage, transport, and measurement requirements;
- opaque and contract-specific pricing;
- large commercial shipment sizes despite the possibility of small digital accounting units;
- meaningful custody and title questions;
- a prior tokenization attempt that did not put reserve, title, custody, and redemption controls into the token contract;
- a live Colorado production and processing ecosystem that can be researched from primary sources.

A framework that can represent helium truthfully could later generalize to other physical commodities. A framework that fails on helium should not be trusted merely because the token contract compiles.

## 2. The product that can earn attention

### Working label

`RMT Helium Reserve Observatory`

The label is provisional. It describes a verification product, not a token, fund, security, commodity exchange, warehouse receipt, or claim of available inventory.

### One-sentence definition

> An open-source Robinhood Chain testnet system that records signed, versioned, expiring evidence about a synthetic or legally documented physical-helium lot and shows exactly what is verified, stale, disputed, restricted, or still unknown.

### What V0 does

- registers a synthetic test instrument and synthetic physical lot on testnet;
- commits a canonical public evidence manifest hash;
- requires separate issuer, custodian, and independent-attestor signatures;
- records exact quantity standard, purity specification, physical state, region, custody identity, encumbrance state, evidence validity window, and redemption constraints;
- preserves every superseded evidence version;
- changes state automatically or deterministically when evidence expires;
- supports suspension and dispute evidence without deleting history;
- displays source, signer, age, scope, and missing-evidence boundaries;
- proves that mint authorization is zero in the evidence-only phase;
- exposes explorer-verifiable events and a public schema;
- includes adversarial tests for replay, signer substitution, stale evidence, duplicate lots, unknown encumbrances, and false quantity claims.

### What V0 does not do

- no real helium backing;
- no real commodity entitlement;
- no token sale;
- no ERC-20;
- no AMM;
- no price feed;
- no yield;
- no futures, leverage, or synthetic exposure;
- no RMT-token reward or revenue claim;
- no custody of money, crypto, documents, or helium;
- no KYC claim;
- no statement that any producer inventory is available;
- no Robinhood affiliation claim.

## 3. What will attract the right attention

The project must be notable for **truthful infrastructure**, not promotional volume.

### 3.1 The technical hook

Most tokenization demos begin with a token and attach a PDF afterward. RMT should invert that order:

```text
identity
→ rights
→ title
→ custody
→ quantity / quality
→ encumbrance
→ attestation
→ freshness
→ dispute handling
→ mint cap
→ instrument
→ market
```

The public thesis is:

> Before a real-world asset can trade safely, the market needs a machine-verifiable answer to what the asset is, who owes the obligation, where the backing is, whether the backing is already claimed, how current the evidence is, and what the holder can actually redeem.

### 3.2 The Robinhood Chain hook

The prototype should use Robinhood Chain testnet for three visible reasons:

1. Robinhood Chain is explicitly designed for RWA applications.
2. The evidence commitment becomes independently inspectable on the same network where a later admitted instrument could exist.
3. RMT can demonstrate a richer RWA classification than `token symbol + DEX pool` without pretending to be Robinhood's canonical asset issuer.

### 3.3 The Colorado hook

Colorado provides a legitimate research narrative:

- Quantinuum publicly documents helium use and recycling in quantum-computing operations in Colorado.
- Blue Star Helium / Helium One's Pinon Canyon operation is producing helium in Las Animas County.
- Tumbleweed Midstream operates the Ladder Creek helium plant in eastern Colorado and publicly describes 99.999% liquid-helium production.
- CEESI operates an ISO/IEC 17025-accredited flow-calibration facility in Nunn, Colorado.

These facts create a local industrial research corridor. They do not create inventory access or a partnership.

Primary sources:

- Quantinuum: https://www.quantinuum.com/blog/reduce-reuse-recycle-for-heliums-sake
- Blue Star project overview: https://www.bluestarhelium.com/project/overview/
- Blue Star investor announcements: https://www.bluestarhelium.com/investor-centre/asx-announcements/
- Tumbleweed / Ladder Creek: https://tumbleweedmidstream.com/inside-ladder-creek/
- CEESI: https://www.ceesi.com/

## 4. Attention ladder

RMT should earn each escalation. Publicity before evidence creates legal, reputational, and technical risk.

### Stage A — publish the research standard

Deliverables:

- helium admission blueprint;
- Argonon forensic review;
- custody/title/market-structure analysis;
- physical-operations and unit-economics analysis;
- Robinhood alignment and visibility plan;
- evidence-registry V0 specification;
- source register using primary sources wherever possible;
- explicit unknowns and kill criteria.

Success condition:

- a technical reviewer can understand the proposed trust model without a sales call;
- no document claims a partner, reserve, price, endorsement, or legal classification that has not been proven.

### Stage B — build the testnet evidence proof

Only after a separate owner architecture decision and non-overlapping implementation PR:

- deploy a non-upgradeable, versioned `CommodityEvidenceRegistryV0` to Robinhood Chain testnet;
- register synthetic parties and a synthetic helium lot;
- publish canonical manifest and schema hashes;
- generate issuer, custodian, and attestor test signatures from separate keys;
- demonstrate evidence publication, supersession, expiration, dispute, suspension, and closure;
- publish source code and deterministic deployment evidence;
- provide adversarial tests and a threat model;
- show every transaction in the Robinhood Chain testnet explorer.

Success condition:

- an outside developer can reproduce the signatures, manifest hashes, state transitions, and test results;
- no token exists and no real-world value is implied.

### Stage C — add a read-only RMT evidence surface

This must be integrated into canonical VNext rather than creating another terminal architecture.

Potential information hierarchy:

```text
RWA class
Verification state
Holder rights
Issuer / obligor
Producer
Custodian / title holder
Independent attestor
Commodity specification
Quantity standard
Purity specification
Physical state
Region / delivery point
Encumbrance status
Evidence freshness
Redemption minimum
Transfer restrictions
Source documents
Onchain evidence history
Unknowns / disputes
```

The UI must label the demo as synthetic testnet evidence. It must not use a green `verified` badge without defining exactly what was verified and by whom.

Current coexistence constraint:

- draft PR #368 modifies public Robinhood Chain discovery, layout, footer, sitemap, and search-distribution files;
- the helium research branch must not touch those files;
- any future UI tranche should wait until #368 is resolved and then compare changed files against active Codex work before implementation.

### Stage D — publish a reproducible technical demonstration

The public package should include:

- a two-to-five-minute screen recording;
- testnet contract address;
- testnet transaction links;
- repository and exact commit;
- architecture diagram;
- evidence-manifest example;
- signature-verification instructions;
- adversarial-test summary;
- limits and non-goals;
- independence statement;
- no-token statement;
- request for technical feedback.

The demonstration should show failure, not only success:

1. valid evidence is accepted;
2. stale evidence becomes stale;
3. a wrong custodian signature fails;
4. a duplicate physical-lot key fails;
5. unknown encumbrance cannot become verified;
6. suspension overrides market presentation;
7. old versions remain auditable.

### Stage E — seek Robinhood and Arbitrum technical feedback

Only after the testnet proof is reproducible should RMT contact official channels.

Robinhood's documentation provides channels for technical questions and partnership discussions. The first message should ask for **technical feedback and ecosystem fit**, not endorsement, listing, funding, or access to Robinhood customers.

Contact package:

- 150-word technical summary;
- one-page architecture diagram;
- explorer links;
- repository link and exact commit;
- clear statement that the evidence is synthetic;
- exact request: review whether the approach fits Robinhood Chain's RWA builder priorities and identify the proper ecosystem/program channel;
- explicit independent-project disclaimer.

Official references:

- Robinhood Chain report/partnership page: https://docs.robinhood.com/chain/report-issue/
- Robinhood Chain terms: https://docs.robinhood.com/chain/terms-of-service/
- Arbitrum Open House: https://openhouse.arbitrum.io/

No message is authorized or sent by this document.

### Stage F — enter the appropriate builder program

The project should be packaged for the next available Robinhood Chain / Arbitrum builder program rather than waiting for organic discovery.

The submission should emphasize:

- technical execution;
- RWA evidence integrity;
- product clarity;
- truthful status and jurisdiction boundaries;
- composability without premature financialization;
- open-source reproducibility;
- a path from synthetic testnet evidence to a small, counsel-reviewed physical pilot.

RMT should not imply admission to any program until formally accepted.

### Stage G — physical-side diligence

Only after the evidence prototype exists should RMT request exploratory calls with potential physical-side participants.

The first ask should be narrow:

> We are researching an evidence standard for physical helium. We are not asking you to issue a token or commit inventory. Would your organization review the proposed quantity, quality, title, custody, and attestation fields and identify what is commercially unrealistic?

That ask is more credible than requesting inventory before RMT has a working evidence model.

## 5. Minimum package before Robinhood outreach

All items are mandatory unless explicitly waived by an owner decision.

### Product proof

- [ ] Working Robinhood Chain testnet registry.
- [ ] Synthetic helium instrument and batch only.
- [ ] Separate test issuer, custodian, and attestor keys.
- [ ] Public manifest and schema.
- [ ] Expiration and stale-state demonstration.
- [ ] Dispute and suspension demonstration.
- [ ] Duplicate-lot rejection.
- [ ] Zero mint authorization.
- [ ] Explorer-verifiable state history.

### Engineering proof

- [ ] Non-upgradeable/versioned deployment or a documented reason for another model.
- [ ] Exact source verification.
- [ ] Deterministic build/deployment evidence.
- [ ] Unit and adversarial tests.
- [ ] Static analysis and secret scan.
- [ ] Chain ID and contract-domain replay protection.
- [ ] Key-rotation and signer-revocation model.
- [ ] No arbitrary external call capability.
- [ ] No custody or asset-transfer capability.

### Documentation proof

- [ ] Architecture diagram.
- [ ] Data dictionary.
- [ ] Threat model.
- [ ] Trust assumptions.
- [ ] Evidence freshness policy.
- [ ] Dispute policy.
- [ ] Public/private manifest split.
- [ ] Legal-issue matrix labeled as unresolved.
- [ ] Independence statement.
- [ ] No-token/no-value statement.

### Presentation proof

- [ ] RMT UI labels every demo record as synthetic.
- [ ] No producer logo without permission.
- [ ] No Robinhood logo or implied endorsement.
- [ ] No commodity price, APY, expected return, or investment language.
- [ ] No use of `backed`, `redeemable`, or `verified reserves` for synthetic evidence.
- [ ] Every status has a plain-language explanation.

## 6. Five-minute demonstration script

### Minute 0–1: the problem

Show a generic token claiming to be helium-backed and ask:

- Which physical lot?
- What unit standard?
- What purity?
- Who owns it?
- Where is it held?
- Is it already committed under an offtake?
- When was it measured?
- Who independently verified it?
- What can a holder actually redeem?

Then show that a DEX pool answers none of those questions.

### Minute 1–2: the evidence package

Open the synthetic RMT helium record and show:

- instrument identity;
- synthetic producer, custodian, and attestor;
- exact quantity/purity/state definitions;
- public manifest hash;
- evidence validity window;
- encumbrance status;
- transferability `none`;
- mint authorization `0`.

### Minute 2–3: onchain verification

Open the testnet explorer and verify:

- registry deployment;
- evidence publication;
- three-party signatures;
- version number;
- manifest commitment;
- timestamp and expiry.

### Minute 3–4: failure behavior

Submit or replay invalid examples:

- wrong signer;
- wrong chain domain;
- duplicate lot;
- expired evidence;
- unknown encumbrance.

Show that the registry/UI fails closed.

### Minute 4–5: the path to a real pilot

Explain that the system has not issued an asset. A real pilot would require:

- produced inventory;
- legal title and bankruptcy treatment;
- specialist custody;
- calibrated quantity measurement;
- independent purity analysis;
- no conflicting offtake/lien;
- insurance where required;
- counsel-reviewed holder rights and transfer restrictions;
- real redemption before secondary liquidity.

End with a narrow request for technical and physical-market feedback.

## 7. Public positioning

### Recommended technical description

> RMT is researching an evidence-first physical-commodity layer for Robinhood Chain. The first testnet prototype will not issue or trade helium. It will prove whether a claimed physical lot has machine-readable, independently signed, expiring evidence for quantity, quality, title, custody, encumbrance, and redemption constraints before any instrument can be admitted.

### Recommended headline

> Before tokenizing helium, prove the helium.

### Recommended subheading

> RMT Helium Reserve Observatory is a testnet research project for verifiable physical-commodity evidence on Robinhood Chain.

### Language to avoid

Do not publish:

- `Robinhood is working with RMT`;
- `Robinhood-backed helium`;
- `official Robinhood helium token`;
- `RMT owns helium reserves`;
- `Blue Star is supplying RMT`;
- `Quantinuum will buy the token`;
- `guaranteed helium appreciation`;
- `first-ever helium token`;
- `fully compliant`;
- `approved by the SEC/CFTC/FinCEN`;
- `1 token equals deliverable helium` before executed legal/custody terms exist.

### Independence disclosure

Every public prototype page should state substantially:

> RMT is an independent third-party application. It is not affiliated with, sponsored by, endorsed by, or operated by Robinhood. Testnet evidence is synthetic and represents no commodity, security, investment, redemption right, or monetary value.

## 8. Partner-role map

The following are research candidates, not recommendations or relationships.

| Role | What must be proven | Public research candidates | Current status |
| --- | --- | --- | --- |
| Producer / inventory source | produced inventory, legal ability to sell, lot identity, no conflicting offtake | Blue Star / Helium One Pinon Canyon; other U.S. producers | public-source research only |
| Processing / liquefaction | quantity inputs/outputs, purity, custody transitions, loss accounting | Tumbleweed Midstream Ladder Creek | public-source research only |
| Industrial-gas custodian / transfill | segregated inventory, custody agreement, measurement, withdrawal workflow | established industrial-gas and specialist helium operators | role not qualified |
| Flow measurement | calibrated metering, uncertainty, traceability, applicable fluid/pressure range | CEESI | capability question not submitted |
| Quality / assay | representative sampling, chain of custody, purity/impurity analysis | Atlantic Analytical; other ISO/IEC 17025 gas laboratories | capability question not submitted |
| Noble-gas/raw-gas analysis | composition and isotope analysis before final product specification | Smart Gas Sciences; other laboratories | capability question not submitted |
| Legal title / trustee / SPV | holder right, title passage, bankruptcy remoteness, lien priority | specialist counsel and regulated fiduciary candidates | not identified/retained |
| Insurance | physical loss, transit, custody, professional liability | specialist commodity/industrial insurers | not identified |
| Independent reserve attestor | reconcile physical records, custody, title, encumbrance and outstanding units | audit/assurance candidates with commodity competence | not identified |
| Transfer/KYC operator | identity, sanctions, jurisdiction, transfer eligibility | regulated service providers if required | not admitted |

### Candidate-source notes

Tumbleweed publicly states that Ladder Creek:

- is in eastern Colorado;
- produces liquid helium at 99.999% purity;
- has approximately 1.5 MMcf/day production capability;
- loads liquid helium for industrial-gas markets.

Source: https://tumbleweedmidstream.com/inside-ladder-creek/

CEESI publicly states that it:

- is accredited to ISO/IEC 17025 by A2LA;
- performs NIST-traceable flow-meter calibrations;
- operates a Colorado facility in Nunn.

Sources:

- https://www.ceesi.com/
- https://www.ceesi.com/quality-assurance
- https://www.ceesi.com/calibration-capabilities

Atlantic Analytical publicly states that it:

- performs independent high-purity gas analysis including helium;
- supports on-site sampling and chain-of-custody workflows;
- is accredited to ISO/IEC 17025:2017.

Sources:

- https://atlanticanalytical.com/industrial-services/industrial-expertise
- https://atlanticanalytical.com/iso-iec-17025
- https://atlanticanalytical.com/sample-submissions

These public capabilities do not prove that any organization will serve an RMT pilot or that its accreditation scope covers the exact proposed measurement or assay.

## 9. Comparable physical-commodity lessons

### PAX Gold

Paxos publicly describes:

- allocation to specific physical gold bars;
- independent monthly supply-to-reserve attestation;
- insured custody;
- pro-rata ownership when a holder owns less than a full bar.

Sources:

- https://support.paxos.com/articles/5991013388-insurance-of-gold-assets-and-published-attestation-reports
- https://support.paxos.com/articles/7204091747-paxg-allocation-and-physical-gold-bar-details-representing-my-paxg-tokens

Lesson for RMT:

- allocation and reserve reconciliation must be explicit;
- fractional accounting does not require fractional physical packaging;
- custody and insurance evidence are separate from the token balance.

### xU3O8

Uranium.io publicly describes:

- uranium held at a regulated Cameco facility;
- Archax acting as trustee;
- monthly proof-of-reserve statements;
- physical redemption restricted to regulated persons with appropriate storage arrangements;
- a minimum physical redemption of 10,000 pounds, approximately 160,000 xU3O8 units.

Sources:

- https://help.uranium.io/en/articles/10711639-where-is-the-physical-uranium-ore-concentrate-u3o8-stored
- https://app.uranium.io/en/redeem
- https://app.uranium.io/en/tokenize

Lesson for RMT:

- a small digital unit can coexist with a very large physical-withdrawal minimum;
- book-entry transfer at a regulated facility can be more realistic than delivery to a retail address;
- transfer and redemption eligibility may be narrower than purchase or display access.

### Argonon

The existing RMT forensic document records that the inspected ARG token contract did not itself encode batch, title, custody, reserve, encumbrance, attestation, redemption, transfer eligibility, or reserve-capped minting.

Lesson for RMT:

- a standard token plus an offchain promise is not the standard to copy;
- the differentiator must be the evidence and control architecture.

## 10. Success metrics

### Research metrics

- every material claim has a primary source or is explicitly labeled inference;
- every unknown remains visible;
- no partner or inventory claim is inferred from a public webpage;
- no conflict between source definitions and RMT terminology;
- exact legal questions are ready for counsel.

### Testnet metrics

- 100% rejection of invalid signer/domain/replay cases;
- 100% rejection of active duplicate physical-lot keys;
- deterministic stale state after expiry;
- append-only evidence history;
- zero token supply and zero mint authority;
- complete source verification and reproducible deployment;
- no secrets or private physical documents in repository or onchain storage.

### Product metrics

- an unfamiliar reviewer can answer the eight core questions: what, who owes, who holds, how much, what quality, where, whether encumbered, and what rights;
- mobile and desktop show the same evidence hierarchy;
- source and evidence age are visible without opening a tooltip;
- no status can be mistaken for Robinhood approval;
- public pages remain useful even when evidence is stale or disputed.

### Ecosystem metrics

- Robinhood/Arbitrum technical feedback received through an official channel;
- accepted into a relevant builder program or review process, if available;
- independent developer reproduces the demo;
- at least one qualified physical-market professional critiques the schema;
- at least one qualified lawyer identifies a potentially viable legal structure before any real pilot.

These are goals, not promised outcomes.

## 11. Workstream sequence

### Workstream 1 — specification completion

Current authorization: research documentation only.

- finish evidence-registry V0 specification;
- define canonical manifest schema;
- define party/signature model;
- define state machine and adversarial cases;
- define public/private evidence split;
- prepare implementation issue without opening a runtime PR.

### Workstream 2 — architecture admission decision

Required owner decision:

- admit a testnet-only evidence registry as a new RWA research tranche;
- confirm no token, no price, no trading, no real asset;
- select a branch after checking active Codex PRs;
- define whether the prototype appears inside VNext or an isolated development-only surface;
- record that research does not alter current canonical Stock Token identity.

### Workstream 3 — testnet contract and tests

Separate implementation PR only:

- registry contract;
- EIP-712 signing helpers;
- synthetic fixtures;
- Foundry/adversarial tests;
- deployment simulation;
- Robinhood Chain testnet deployment only after explicit authorization;
- source verification and explorer evidence.

### Workstream 4 — RMT read-only surface

Separate PR after #368 and active Codex overlap are resolved:

- evidence resolver;
- read model;
- selected-asset/RWA presentation;
- synthetic-demo banner;
- no execution integration;
- no sitemap/SEO changes unless separately coordinated.

### Workstream 5 — technical release

- publish demo package;
- request Robinhood and Arbitrum feedback;
- enter appropriate builder programs;
- collect critiques before physical-party outreach.

### Workstream 6 — physical feasibility

- qualified counsel;
- producer/custodian/attestor discovery;
- real storage and withdrawal economics;
- insurance and bankruptcy analysis;
- possible small stationary-custody pilot;
- no secondary market until primary issuance and redemption are proven.

## 12. Go / no-go decision

### Go now

Proceed with:

- research;
- open specification;
- synthetic evidence schema;
- testnet implementation planning;
- builder-program monitoring;
- outreach-package preparation.

### Do not do now

Do not:

- deploy a helium token;
- market the RMT token as helium-backed;
- contact the public claiming a producer relationship;
- ask retail users for money;
- create a helium AMM;
- publish a universal helium price;
- use real producer filings as if they were reserve attestations for RMT;
- expose confidential plant coordinates, contracts, custody records, or commercial pricing;
- contact Robinhood with only a concept and no reproducible proof;
- merge this research as production authority.

## 13. Current recommendation

Build the evidence standard first and make the failure behavior visible.

The most credible attention-producing milestone is:

> A reproducible Robinhood Chain testnet demonstration where three independently controlled test parties sign a synthetic helium evidence package; RMT proves the package's integrity and freshness; a duplicate lot, stale attestation, wrong signer, unknown encumbrance, or replay is rejected; and no token or monetary value exists.

That is distinct enough to demonstrate original RWA infrastructure, narrow enough to complete safely, and aligned enough with Robinhood Chain's public RWA builder mission to justify submitting for technical feedback.

The headline is not that RMT created another asset.

The headline is that RMT is building the admission layer that prevents an unproven real-world claim from becoming an asset merely because someone deployed a token.

## Source register

### Robinhood / Arbitrum

1. Robinhood Chain mainnet overview: https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/
2. Robinhood Chain mainnet announcement: https://robinhood.com/us/en/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/
3. Robinhood Chain documentation: https://docs.robinhood.com/chain/
4. Robinhood Chain testnet announcement: https://robinhood.com/us/en/newsroom/robinhood-chain-launches-public-testnet/
5. Robinhood Chain report/partnership page: https://docs.robinhood.com/chain/report-issue/
6. Robinhood Chain terms: https://docs.robinhood.com/chain/terms-of-service/
7. Arbitrum Robinhood Chain announcement: https://blog.arbitrum.io/robinhood-chain-testnet/
8. Arbitrum Open House: https://openhouse.arbitrum.io/

### Helium / physical operations

9. Quantinuum helium use and recovery: https://www.quantinuum.com/blog/reduce-reuse-recycle-for-heliums-sake
10. Blue Star project overview: https://www.bluestarhelium.com/project/overview/
11. Blue Star ASX announcements: https://www.bluestarhelium.com/investor-centre/asx-announcements/
12. Tumbleweed Ladder Creek: https://tumbleweedmidstream.com/inside-ladder-creek/
13. CEESI: https://www.ceesi.com/
14. CEESI quality assurance: https://www.ceesi.com/quality-assurance
15. Atlantic Analytical industrial expertise: https://atlanticanalytical.com/industrial-services/industrial-expertise
16. Atlantic Analytical accreditation: https://atlanticanalytical.com/iso-iec-17025
17. Smart Gas Sciences: https://www.smartgassciences.com/

### Comparable commodity models

18. Paxos gold insurance/attestation: https://support.paxos.com/articles/5991013388-insurance-of-gold-assets-and-published-attestation-reports
19. Paxos allocation model: https://support.paxos.com/articles/7204091747-paxg-allocation-and-physical-gold-bar-details-representing-my-paxg-tokens
20. Uranium custody/proof of reserves: https://help.uranium.io/en/articles/10711639-where-is-the-physical-uranium-ore-concentrate-u3o8-stored
21. Uranium redemption: https://app.uranium.io/en/redeem
22. Uranium tokenization: https://app.uranium.io/en/tokenize

## Research integrity notes

- Public company statements are treated as company statements, not independent reserve evidence.
- Capability webpages are not evidence that a vendor will accept RMT, meet a particular scope, or sign an attestation.
- Legal classifications remain unresolved until qualified counsel reviews an exact instrument and funds flow.
- Robinhood Chain's permissionless design does not authorize use of Robinhood branding or claims of endorsement.
- A testnet deployment would be a technical experiment only.
- No outreach has been sent under this research track.
