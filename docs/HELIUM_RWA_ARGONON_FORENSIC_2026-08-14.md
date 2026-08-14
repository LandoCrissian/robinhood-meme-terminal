# Argonon helium-token forensic review

**Status:** RESEARCH — NOT ARCHITECTURE AUTHORITY  
**Date:** 2026-08-14  
**Parent research:** [`HELIUM_RWA_RESEARCH_2026-08-14.md`](HELIUM_RWA_RESEARCH_2026-08-14.md)

> Purpose: extract design lessons from the existing Argonon Helium (`ARG`) implementation. This is not an endorsement, accusation, investment opinion, or legal conclusion. Public company/project/exchange statements are treated as claims unless independently proven.

## Executive finding

Argonon is a valuable precedent because it separates the **tradable token contract** from the **physical-helium redemption arrangement** — but the public onchain contract does not itself prove or enforce helium reserves, title, custody, redemption eligibility, or transfer compliance.

That is the most important lesson for RMT.

RMT should not reproduce a model in which a generic transferable ERC-20/BEP-20 is called commodity-backed while the backing invariant exists only in an offchain platform or operator process. A future RMT-admitted physical commodity should make reserve authority, evidence freshness, outstanding supply, encumbrance status, and redemption state independently auditable.

## 1. Identity

Public BitMart and BscScan records identify:

```text
Token name:     Argonon Helium
Symbol:         ARG
Network:        BNB Smart Chain
Token standard: BEP-20 / ERC-20 style
Contract:       0x701d9A068d1EeC64fbC10299B9f1B18Fbb355DDB
Decimals:       18
Compiler:       Solidity 0.5.17
```

Primary explorer:
- https://bscscan.com/token/0x701d9A068d1EeC64fbC10299B9f1B18Fbb355DDB

BitMart project description:
- https://bitmart.zendesk.com/hc/en-us/articles/5650106229531-Argonon-ARG

## 2. Contract behavior

BscScan shows verified source for `ArgHe`.

The constructor mints the fixed initial supply to one address:

```solidity
_mint(
    0xD52AD7bdf3888bc0c5103Ee56693e5315033c7C3,
    1000000000 * 10**18
);
```

The public ABI is essentially a standard transferable/burnable token:

- `transfer`
- `transferFrom`
- `approve`
- `increaseAllowance`
- `decreaseAllowance`
- `burn`
- `burnFrom`
- normal ERC-20 read methods

The inspected contract does **not** expose an onchain function or state machine for:

- registering helium batches;
- proving quantity or purity;
- proving title;
- proving custody;
- identifying storage/delivery location;
- recording liens/offtake/encumbrances;
- storing reserve attestations;
- limiting outstanding transferable supply to an independently verified physical reserve;
- requesting physical redemption;
- locking units during redemption;
- confirming delivery;
- forcing a redemption burn from a custody authority;
- enforcing KYC/jurisdiction eligibility;
- restricting transfers based on legal eligibility;
- updating a commodity price oracle.

This does **not** prove the overall Argonon system lacks those controls elsewhere. It proves only that those controls are not enforced by the inspected token contract itself.

## 3. Physical redemption claim lives outside the token contract

Argonon's current site states:

```text
1000 ARG tokens can be redeemed for 1 Mcf of helium
```

BitMart's 2022 project description likewise said the token represented a right to redeem an underlying quantity of helium and that the redemption facility was accessible through the Argonon online platform.

Sources:
- https://argonon-he.com/
- https://bitmart.zendesk.com/hc/en-us/articles/5650106229531-Argonon-ARG

Therefore, from the public evidence inspected so far, the economic/redemption linkage depends on legal/platform arrangements outside the BEP-20 token contract.

RMT design implication:

> `token balance` must never be treated as sufficient proof of a physical-commodity right unless the exact legal instrument, issuer obligation, custody arrangement, reserve evidence, and redemption process are resolved and current.

## 4. Supply arithmetic exposes an important architecture issue

The Renergen announcement described a potential forward sale of **100,000 Mcf** to Argonon.

Argonon's current site states **1,000 ARG = 1 Mcf** and also displays:

```text
1,000,000,000 ARG total supply
100,000,000 ARG available at launch
```

The initial forward-sale quantity and redemption ratio imply:

```text
100,000 Mcf × 1,000 ARG/Mcf = 100,000,000 ARG
```

That exactly matches the site's stated `100M available at launch` figure.

This is an inference from the published numbers, not proof of the internal treasury accounting. It strongly suggests that the first 100M-token commercial tranche was intended to map to the 100,000-Mcf Renergen arrangement while the contract pre-minted a larger 1B-token maximum supply for a broader future program.

The token contract itself does not enforce a `100M` transferable ceiling. The full initial supply was minted to the designated address, so any restriction on releasing only reserve-supported supply must exist in treasury/legal/operational controls outside the token code.

### RMT lesson

Do not pre-mint a large commodity-token supply and rely on operator discipline to keep the unbacked portion out of circulation.

A stronger design is:

```text
verified unencumbered inventory
→ signed mint authorization with batch/evidence identity
→ contract-enforced mint cap
→ outstanding supply reconciliation
→ burn/release on redemption
```

with the invariant:

```text
outstanding redeemable units <= currently verified eligible backing
```

## 5. Exchange lifecycle

BitMart announced the original ARG primary listing in 2022.

BitMart later announced that `ARG_USDT` would be delisted on **14 August 2025**, with withdrawals scheduled to close on **14 October 2025**.

Sources:
- 2022 primary listing: https://bitmart.zendesk.com/hc/en-us/articles/5653811474843-Argonon-ARG-Primary-Listing-on-BitMart
- 2025 delisting: https://bitmart.zendesk.com/hc/en-us/articles/39938911975579-Announcement-on-the-Delisting-of-XBN-WEMIX-W8-STATS-SHIBAMETA-MMD-MEMD-JAM-AZERO-ARG-HERE-SHEPI-ART-FEHU-BREAKER-CFXT-CUBIX-HK-HST-PBX-SHR-SX-ROBIE-APU-SYS-DMC-HAM

The delisting does not establish that the project, token, or redemption right ceased to exist. It does establish that the original centralized-exchange venue did not remain a durable trading venue through 2026.

RMT lesson:

> tokenization does not create durable liquidity by itself.

Any helium design must solve industrial counterparties, primary issuance, redemption, reserve integrity, price discovery, and market-maker economics rather than treating exchange listing as the product.

## 6. Public legal posture

Argonon's current disclaimer states that its website/materials are not themselves an offer to sell securities and says any offer to sell securities would be made under a definitive subscription agreement in reliance on an exemption from U.S. Securities Act registration for non-public offerings.

Source:
- https://argonon-he.com/disclaimer/

This should prevent RMT from assuming that a publicly transferable commodity-token structure is automatically a non-security commodity sale simply because physical helium is referenced.

The specific legal documents governing ARG holders, purchasers, redemptions, jurisdictions, and transfer restrictions require further retrieval before any direct legal comparison can be made.

## 7. Documentation availability issue

BitMart's project page and Argonon's current navigation reference a February 2022 whitepaper URL:

- `https://argonon-he.com/wp-content/uploads/2022/02/ArgononWhite-PaperFeb22.pdf`

During this research pass, that public URL returned `404 Not Found`.

This may be a website-maintenance issue rather than evidence about the underlying product. Nevertheless, it demonstrates a problem RMT should design against: the legal/economic evidence that defines a physical RWA must not depend on a mutable website link remaining available forever.

RMT evidence should preserve at least:

- immutable content hash;
- document version;
- issuer identity;
- effective timestamp/block boundary where applicable;
- archival/retrieval location;
- supersession/revocation relationship;
- signature or provenance evidence.

## 8. Comparison: observed Argonon token versus proposed RMT evidence-first model

| Dimension | Public ARG token evidence | RMT research requirement |
| --- | --- | --- |
| Token transfer | Standard transferable BEP-20 | Separate from RWA verification |
| Fixed supply | 1B originally minted | Prefer reserve-authorized minting |
| Burn | Standard burn/burnFrom | Redemption-aware lock/burn lifecycle |
| Physical batch ID | Not in token contract | Required |
| Purity/state | Not in token contract | Required instrument metadata |
| Title evidence | Not in token contract | Required |
| Encumbrance | Not in token contract | Required |
| Custody | Not in token contract | Required |
| Reserve attestation | Not in token contract | Required + freshness state |
| Mint cap vs reserve | Not in token contract | Contract/evidence enforced |
| Redemption | Offchain platform claim | Explicit reconciled lifecycle |
| Jurisdiction controls | Not in token contract | Independent policy gate |
| Price oracle | Not in token contract | Do not invent universal oracle |
| Durable evidence | Mutable web materials | Hash/version/provenance required |
| Market liquidity | Original BitMart venue later delisted | Must be treated as separate market-admission problem |

## 9. What not to copy

RMT should not copy these characteristics merely because they already exist in a helium-token precedent:

1. generic ERC-20/BEP-20 balance treated as self-proving commodity backing;
2. large pre-mint whose reserve-supported circulating limit is controlled only operationally;
3. physical redemption defined exclusively by an external platform;
4. mutable website documents as the only public evidence surface;
5. ticker/branding as RWA identity;
6. exchange listing as proof of a sustainable market;
7. unrestricted onchain transfer assumed to equal compliant legal title transfer.

## 10. What is worth preserving as a design insight

The precedent contains several useful ideas:

- Mcf is a commercially meaningful quantity basis to investigate;
- physical specification matters;
- the 1,000-token-to-1-Mcf ratio created retail divisibility while preserving a physical redemption unit;
- a dedicated redemption facility is conceptually separate from the exchange venue;
- blockchain can be useful for ownership/transfer accounting even when the physical commodity remains offchain;
- the real product problem is connecting commodity rights, inventory, and price discovery rather than merely deploying an ERC-20.

## 11. Remaining forensic work

Before closing the Argonon research item, determine:

- [x] public token contract and network;
- [x] source-code shape and mint model;
- [x] public redemption ratio;
- [x] original centralized-exchange listing;
- [x] current BitMart delisting status;
- [x] public legal disclaimer posture;
- [ ] recover and archive the governing whitepaper or a verified historical copy;
- [ ] identify the exact subscription agreement / token purchase terms;
- [ ] identify the exact redemption agreement and physical-delivery terms;
- [ ] determine whether any physical redemption has been publicly evidenced;
- [ ] map the treasury/multisig signers and release controls from public evidence where appropriate;
- [ ] reconcile current token distribution and treasury balances from onchain data;
- [ ] determine whether other exchanges or DEX pools have meaningful current liquidity;
- [ ] determine whether the Renergen forward-sale agreement remains operative and how much helium, if any, was actually prepaid/purchased under it;
- [ ] identify reserve/custody reports or attestations, if any;
- [ ] compare current redemption liabilities with documented physical entitlements.

## 12. Current RMT conclusion

The forensic pass strengthens the original recommendation:

**Do not turn RMT itself into a helium-backed token.**

If RMT eventually admits a helium RWA, the helium entitlement should be a separate instrument whose reserve and redemption obligations are provable independently from RMT. The RMT token can be researched later as a verification/evidence-market utility, but it should not silently inherit a claim on physical helium.

The differentiator RMT can build is not a new token wrapper. It is an evidence and reconciliation system that makes it materially harder for a physical-RWA issuer to over-issue, double-pledge inventory, carry stale attestations, or hide the distinction between a liquid token balance and an enforceable physical right.

## Sources

- BscScan token/verified contract: https://bscscan.com/token/0x701d9A068d1EeC64fbC10299B9f1B18Fbb355DDB
- BitMart ARG project page: https://bitmart.zendesk.com/hc/en-us/articles/5650106229531-Argonon-ARG
- BitMart 2022 primary listing: https://bitmart.zendesk.com/hc/en-us/articles/5653811474843-Argonon-ARG-Primary-Listing-on-BitMart
- BitMart 2025 ARG delisting: https://bitmart.zendesk.com/hc/en-us/articles/39938911975579-Announcement-on-the-Delisting-of-XBN-WEMIX-W8-STATS-SHIBAMETA-MMD-MEMD-JAM-AZERO-ARG-HERE-SHEPI-ART-FEHU-BREAKER-CFXT-CUBIX-HK-HST-PBX-SHR-SX-ROBIE-APU-SYS-DMC-HAM
- Argonon home / redemption ratio: https://argonon-he.com/
- Argonon disclaimer: https://argonon-he.com/disclaimer/
- Argonon audit page: https://argonon-he.com/smart-contract-security-audit/
- Renergen 18 Oct 2021 forward-sale announcement: https://www.renergen.co.za/wp-content/uploads/2021/10/Helium-Spot-Market-Establishment-Oct-18-JSE-Version-FINAL2-1.pdf
