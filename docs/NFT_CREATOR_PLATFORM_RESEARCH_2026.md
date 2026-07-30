# NFT and creator platform research

Research date: July 29, 2026

This document records the product evidence behind RMT's creator asset and rights foundation. It is not a partnership claim, legal opinion, audit, or commitment to deploy marketplace contracts.

## Competitive map

| Platform | What works | Friction or boundary | RMT implication |
| --- | --- | --- | --- |
| OpenSea | OS2 combines NFTs and tokens, multi-chain aggregation, cross-chain purchasing, analytics, notifications and improved discovery. Its 2026 mobile product adds a unified portfolio and social feed. | OpenSea states that creator fees vary, and its OS2 help material acknowledges that not every legacy feature exists in OS2. | Combine discovery, ownership and trading without hiding data source, freshness, fees or feature status. Make mobile a primary surface. |
| Magic Eden | Multi-chain marketplace, mobile wallet/app, creator hub, games and safety documentation. Listing is free and its published transaction fee is 2%. | Its Solana documentation explains that royalties can be optional for non-enforced collections. Verification, reporting and collection ownership are separate workflows. | Show royalty preference separately from enforcement. Put creator ownership, reports and review status in one project record. |
| Blur | Fast trader-oriented aggregation, bidding/liquidity features and public contract/governance documentation. Governance can manage a marketplace fee up to 2.5%. | A professional trading surface does not replace creator context, rights provenance or human-readable signature review. | Carry RMT terminal speed and analytics into marketplace pages, while giving collectors a pre-sign release passport. |
| Zora | Transparent creator/referral/protocol fee allocations and creator-linked market mechanics. | Permanent creator-coin behavior and tokenized attention are not appropriate defaults for every artist, musician or game developer. | Keep tokenization optional. Make every fee destination visible and versioned before signing. |
| Foundation | Collaborative primary and secondary earnings splits are understandable to creators. | Its help center says split recipients cannot be changed after minting and caps the group at four total recipients, citing gas costs. | Collect proposed splits and signed consent before minting; bind every signature to one immutable revision. |
| Manifold | Creator-owned contracts let creators establish independent onchain provenance instead of being trapped in a marketplace-owned collection. | Ownership alone does not provide discovery, safety review, marketplace liquidity or understandable release preparation. | Prefer creator-controlled contracts with RMT as infrastructure and discovery—not as the hidden owner of creator assets. |
| Sound | Music-native collecting, artist rewards, curator referrals and collaborator withdrawal through wallet-based splits. | Music requires master, composition, collaborator and payout data that a generic image NFT form does not capture. | Treat music as a first-class release type with music-specific rights and collaborators. |
| Audius | Free uploads, published artist/network economics, editable release metadata and copyright procedures. | Community feedback includes concern about engagement incentives, AI-generated spam and discovery quality. | Support updates before immutable release, disclose AI involvement, review creator pages and avoid rewarding raw upload volume. |

## Primary sources

- OpenSea, [Introducing OS2](https://opensea.io/blog/articles/introducing-os2), February 13, 2025.
- OpenSea, [OS2 out of beta](https://opensea.io/blog/articles/opensea-announces-os2-is-now-out-of-beta-token-trading-fully-live-across-19-chains-new-rewards-program-launches-and-community-hub-revamped), May 29, 2025.
- OpenSea, [OpenSea Mobile](https://opensea.io/blog/articles/opensea-mobile-is-here-everything-you-own-everywhere-you-go), July 16, 2026.
- OpenSea developer documentation, [OpenSea fees](https://docs.opensea.io/docs/opensea-fees) and [collection settings](https://docs.opensea.io/docs/part-2-edit-collection-settings).
- Magic Eden, [listing and sale fees](https://help.magiceden.io/en/articles/5858632-what-fees-will-i-pay-to-list-or-sell-nfts-on-magic-eden), updated March 9, 2026.
- Magic Eden, [optional royalties](https://help.magiceden.io/en/articles/6645652-how-optional-royalties-work-on-magic-eden-s-solana-marketplace) and [getting listed](https://help.magiceden.io/en/collections/14288232-getting-listed).
- Blur Foundation, [governance](https://docs.blur.foundation/governance) and [contract addresses](https://docs.blur.foundation/contracts).
- Zora, [creator rewards](https://support.zora.co/en/articles/2509953), updated March 12, 2026, and [Creator Coins](https://support.zora.co/en/articles/6316801), updated May 13, 2026.
- Foundation, [splitting earnings on an NFT](https://help.foundation.app/hc/en-us/articles/4513530159131-Splitting-earnings-on-an-NFT).
- Manifold, [the Manifold creator contract](https://help.manifold.xyz/en/articles/9590755-what-is-the-manifold-contract).
- Sound, [creator and curator rewards](https://help.sound.xyz/hc/en-us/articles/12713835355035-What-rewards-can-I-earn), [collaborator withdrawals](https://help.sound.xyz/hc/en-us/articles/15756211760155-How-do-I-withdraw-earnings-from-Sound-xyz), and [collector rights](https://help.sound.xyz/hc/en-us/articles/5306689517595-What-do-I-get-after-purchasing-an-NFT).
- Audius, [costs and fees](https://help.audius.co/product/costs-and-fees), [editing releases](https://help.audius.co/product/editing-your-release), and [copyright policies](https://help.audius.co/product/what-are-the-audius-copyright-policies-and-processes).
- Ethereum standards: [ERC-721](https://eips.ethereum.org/EIPS/eip-721), [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155), and [ERC-2981](https://eips.ethereum.org/EIPS/eip-2981).
- OpenZeppelin, [Contracts documentation](https://docs.openzeppelin.com/contracts) and [ERC-2981 implementation](https://docs.openzeppelin.com/contracts/4.x/api/token/common).

## User feedback reviewed

Community comments are anecdotal rather than representative market research, but several recurring complaints are useful design signals:

- A May 2026 [Web3 trust-layer discussion](https://www.reddit.com/r/web3/comments/1tb3fuc/what_features_would_actually_make_you_trust_a/) emphasizes creator-wallet and contract provenance, explicit pre-sign asset/payment/fee review, public admin controls, narrow approvals, freshness timestamps, report status and a public incident history.
- A May 2026 [OpenSea collection thread](https://www.reddit.com/r/avatartrading/comments/1t4p9pc/why_this_collection_is_disabled_in_opensea/) describes unclear collection disabling and support frustration.
- A 2026 [project-owned marketplace discussion](https://www.reddit.com/r/NFT/comments/1t7exp6/should_nft_projects_own_their_own_marketplace/) values brand control, direct collector experience, provenance and public contract history while recognizing that distribution still matters.
- A March 2026 [OpenSea phishing thread](https://www.reddit.com/r/opensea/comments/1rvbr96/scam_emails/) is a reminder that fake support and unsafe links remain practical risks.
- A February 2026 [Audius community discussion](https://www.reddit.com/r/audius/comments/1rdpymx/audius_is_made_for_us/) raises concern about engagement-first algorithms and low-quality AI-generated spam.

RMT should not convert individual comments into universal claims. It should use them to design measurable tests and clear failure states.

## RMT product principles

1. Trust before gamification. Provenance, permissions, fees and signature meaning must be visible before points or rewards.
2. Creator control. Creator identity and eventual contracts should not be silently owned by RMT.
3. Release passport. Show media permanence, creation method, rights, license, edition, royalty preference, collaborator consent, splits, revision integrity and fee policy separately.
4. Honest royalties. ERC-2981 communicates royalty information; it does not force every marketplace to pay.
5. Consent before splits. A typed wallet signature must bind a collaborator to the exact project, asset revision, role, share, terms, chain, expiry and nonce.
6. Immutable release revisions. Any material change invalidates earlier review and consent.
7. Transparent economics. Show the total fee, allocation and governance boundary before execution. Do not call protocol revenue “yield.”
8. First-class media types. Art, music, games and NFT collections need distinct metadata and rights fields while sharing one provenance layer.
9. Mobile-first review. A user must be able to understand and approve a release or trade without a desktop-only table.
10. Visible operations. Freshness, incident history, report status and support progress should be explicit.

## Build boundary

### Implemented safely now

- Private creator asset and rights drafts.
- AI creation disclosure.
- Music-specific rights confirmations.
- Proposed collaborators and revenue splits.
- Deterministic revision hashes.
- Versioned EIP-712 collaborator invitation envelope.
- Private, revision-bound collaborator invitation records, public revocation-only markers, wallet acceptance/rejection signing, and local signature verification.
- Collaborator-controlled withdrawal of a recorded acceptance before any future executable release freeze, with a separate typed signature and trusted atomic receipt.
- Secondary royalty preference with an explicit non-enforcement warning.
- Non-executable marketplace fee and RMT flywheel policy model.
- Private release-passport readiness evaluation.
- Deterministic marketplace metadata and media-manifest generation, IPFS-versus-HTTPS integrity labeling, revision-bound fingerprints, and a downloadable JSON preview. Metadata remains explicitly unpinned.
- Source-level V7 release and module registries that can bind an immutable creator release revision, payout manifest, fee-policy fingerprint, media manifest and complete module plan without minting, custody or execution. These contracts are tested but not deployed or audited.
- A source-level creator-controlled ERC-721 module that deploys one deterministic collection for an exact frozen release. Sequential token IDs and URI hashes must be proven against the frozen media manifest; supply and royalty signaling are bounded; no marketplace settlement or platform custody exists. The contracts are tested but not deployed or audited.

### Required before marketplace contracts

- Product wiring for the source-level onchain release-freeze boundary and a post-freeze correction or dispute process. A correction must create a new commitment; the original history cannot be rewritten.
- Trusted upload/pinning receipt for the generated metadata manifest and bounded availability verification for every referenced IPFS object.
- Creator and collection identity review with appeals and report status.
- Versioned economics policy selected for a release.
- Human-readable transaction simulation showing assets, payments, approvals, fees, expiry and cancel path.
- Contract architecture, threat model, adversarial tests and independent specialist review.

### Later contract layer

- Creator-controlled ERC-1155 editions.
- Consent-bound split receiver.
- Marketplace settlement for fixed-price listings and offers.
- Auctions only after the simpler settlement path is proven.
- Governance-controlled platform fee routing and RMT token actions.

The source-level ERC-721 collection can mint manifest-bound assets under the immutable creator's control. No current V7 contract lists, charges, pays, buys back, burns, sweeps assets or settles a marketplace transaction.
