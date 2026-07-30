# V7 marketplace contract architecture

Status: source-level foundation only

Date: July 30, 2026

Deployment: none

Audit: none

## Outcome

The V7 source foundation now establishes two narrow registries, one evidence verifier, two creator-collection modules, one consent-bound split module and a non-executable transaction-simulation boundary:

1. `RMTV7ModuleRegistry` is an append-only catalog of exact implementation, interface, code, metadata and policy fingerprints admitted by RMT's delayed governance.
2. `RMTV7MediaEvidenceVerifier` validates short-lived EIP-712 attestations that bind an exact verified provider receipt and healthy availability observation to one release.
3. `RMTV7ReleaseRegistry` lets a creator commit an immutable release revision and atomically freeze its evidence, future modules and configurations.
4. `RMTV7ERC721CollectionModule` deploys one deterministic, creator-controlled `RMTV7CreatorCollection` for an exact frozen release intent.
5. `RMTV7ERC1155EditionModule` deploys one deterministic, creator-controlled `RMTV7CreatorEditions` contract for an exact frozen release intent.
6. `RMTV7ConsentBoundSplitModule` deploys one immutable pull-payment `RMTV7ConsentBoundSplit` only after every recipient signs their exact share and recovery wallet.
7. `creator-v7-transaction-simulation.ts` produces deterministic plain-language receipts and exact calldata for release freeze, both collection deployment modules and the consent-bound split module without reading the chain, signing or broadcasting.
8. `creator-v7-live-state-verifier.ts` verifies one split simulation against reviewed runtime anchors and one pinned block, then executes the exact calldata through read-only `eth_call`; it cannot sign or broadcast.

The ERC-721 module can mint only the sequential token IDs and exact token-URI hashes committed in the release's immutable Merkle manifest. The ERC-1155 module can mint only IDs, URI hashes, terms hashes and lifetime supplies committed in its immutable edition manifest. The split module can receive and distribute native currency or standard non-rebasing ERC-20 creator proceeds only if it is later deployed and funded; it has no platform fee or treasury route. No current module lists, approves, sells, charges a platform fee, settles a purchase, buys RMT, burns RMT, purchases NFTs or claims that RMT approved a creator.

## Why this comes before marketplace settlement

Art, music, game items, ERC-721 collections and ERC-1155 editions share a provenance problem before they share a payment path. Every future mint or sale needs an unambiguous answer to:

- which creator wallet committed the release;
- which project, asset, rights revision and media manifest were reviewed;
- which collaborator payout manifest was accepted;
- which fee policy was disclosed;
- which exact contract modules and configurations the creator intended to use;
- whether a module was active when the creator froze that plan.

The registries solve that binding problem without taking the much larger custody and settlement risk.

## State machines

### Module

```text
unregistered
    |
    | delayed governance registers exact kind + version + implementation
    v
active --------------------------------------------------+
    |                                                    |
    | delayed governance deactivates                     | no overwrite
    v                                                    | no reactivation
inactive (history and code hash retained) <--------------+
```

A corrected implementation must receive a new version. Governance cannot rewrite an existing kind and version.

### Release

```text
creator commits immutable fingerprints
    |
    v
COMMITTED -----------------------> CANCELLED
    |
    | creator supplies 1-8 active module intents plus a current,
    | correctly signed receipt + availability attestation
    v
FROZEN
```

`FROZEN` and `CANCELLED` are terminal. A material correction creates a new release commitment and creator nonce. This preserves the original public record.

## Onchain records

### Module fingerprint

- module kind;
- semantic contract version;
- implementation address;
- declared ERC-165 interface;
- implementation `EXTCODEHASH`;
- reviewed policy hash;
- human-readable metadata hash;
- registration and deactivation timestamps;
- current active status.

The module key includes the chain ID and registry address so it cannot be replayed as an equivalent admission on another chain or registry.

### Release fingerprint

- creator wallet;
- project and asset identifiers as hashes;
- rights revision hash;
- marketplace metadata hash;
- media manifest hash;
- fee-policy hash;
- collaborator payout-manifest hash;
- complete module-manifest hash;
- media-evidence, provider-receipt and availability-observation hashes;
- evidence observation, expiry and signer-epoch values;
- creation, freeze and cancellation timestamps;
- creator-scoped nonce and state.

The release ID includes the chain ID and registry address. An identical payload committed on another chain or deployment produces a different ID.

## Media evidence boundary

`RMTV7MediaEvidenceVerifier` closes the gap between an offchain review record and a release freeze without making the provider or RMT a custodian:

- the EIP-712 domain binds the chain ID and exact verifier contract;
- the signed message binds the release registry, release ID, creator, metadata hash, media-manifest hash, provider-receipt hash, availability-observation hash, observation time, expiry and signer epoch;
- an observation may be no more than 24 hours old at freeze time;
- evidence may remain valid for no more than 48 hours after its observation;
- future, stale, expired, empty, wrong-release, wrong-chain, wrong-verifier, wrong-signer and old-epoch attestations fail closed;
- the release registry stores the exact evidence fingerprints and times when a freeze succeeds;
- signer rotation is available only through delayed governance and immediately invalidates every older epoch;
- the signer can attest to evidence only. It cannot freeze a creator release, select modules, mint, transfer, list, settle, withdraw or execute governance.

The web-side evidence builder independently requires a schema-v3 verified-retrieval receipt, an immutable `preparation_ready` decision for that exact review, and a healthy matching availability status before it constructs the typed message. A future signing service must recheck current collaborator consent, media supersession and takedown state atomically before signing. No signing endpoint or production signer is enabled in this increment.

A successful attestation proves that the configured reviewer observed the bounded provider and gateway checks at a stated time. It does not prove copyright, provider permanence, global IPFS availability or future retrievability.

## Creator collection module

The ERC-721 increment deliberately separates creation from marketplace execution:

- anyone may call the module, but deployment succeeds only when the caller is the frozen release creator;
- the module must still be the active, code-hash-pinned implementation for collection kind/version `1/1`;
- the release must contain the exact configuration hash for that module;
- one `CREATE2` collection is permitted per release ID;
- name, symbol, collection URI, token-manifest root, maximum supply, royalty receiver and royalty basis points are frozen together;
- the immutable original creator is the only wallet allowed to mint;
- token IDs are sequential and every ID/URI pair requires a valid proof against the frozen manifest;
- minting uses ERC-721 safe-receiver behavior and rolls the entire mint back when a receiver rejects it;
- maximum collection supply is 100,000, royalty signaling is capped at 10%, and metadata URI lengths are bounded;
- neither the module nor the collection accepts native funds or exposes an RMT withdrawal or override path.

The collection implements ERC-2981 only as a royalty signal. It cannot force a marketplace to pay royalties. The original creator authority is intentionally non-transferable in this increment; delegated minting, mutable metadata, reveal mechanics, burns, operator filtering and upgradeability are not present.

## Creator editions module

The ERC-1155 increment applies the same creator and frozen-release boundaries to limited editions:

- only the exact frozen creator and configuration can deploy;
- the module must remain the active code-hash-pinned implementation for edition kind/version `2/1`;
- one deterministic editions contract is permitted per release ID;
- name, symbol, collection URI, edition-manifest root, maximum type count, maximum lifetime total supply and royalty signal are frozen together;
- every edition leaf binds token ID, metadata URI hash, terms hash and that ID's lifetime supply ceiling;
- the first successful mint permanently registers an ID's exact configuration;
- alternate valid leaves for the same token ID cannot change its URI, terms or supply ceiling;
- per-ID supply, total lifetime supply and registered type count are independently capped;
- rejected ERC-1155 receiver callbacks roll back the complete registration and mint;
- neither module nor editions contract accepts native funds or exposes an RMT withdrawal or override path.

The source limits are 10,000 edition types, 1,000,000,000 lifetime minted units per collection and a 10% ERC-2981 royalty signal. The web preparation builder derives the exact type and total-supply caps, Solidity-compatible Merkle proofs and configuration hash from the creator's manifest. No signing or broadcast path is enabled.

An edition terms hash is a provenance commitment only. It does not prove copyright, grant rights by itself or make offchain license terms enforceable. See `V7_CREATOR_EDITIONS.md`.

## Consent-bound split module

The split increment converts a frozen payout-manifest commitment into an immutable pull-payment destination without giving the creator or RMT a redirect key:

- one to 32 unique recipients must total exactly 10,000 basis points;
- every recipient signs their exact share, optional recovery wallet, release, creator, module, configuration, payout manifest and deadline;
- EOA and ERC-1271 contract-wallet signatures are supported;
- consent expires within 30 days and cannot replay across a release, module, registry or chain;
- deployment requires both the frozen module configuration and the release's exact payout-manifest hash;
- the deployed split independently recomputes every immutable hash;
- anyone may trigger a normal payment, but it can pay only the recipient;
- only the recipient or their signed recovery wallet may trigger recovery, and it can pay only that recovery wallet;
- a failed transfer reverts its accounting and does not block other recipients;
- there is no creator, governance or RMT sweep, arbitrary redirect, fee, proxy or upgrade path.

The web builder canonically orders recipients and produces the exact unsigned EIP-712 review packet and Solidity-compatible hashes. Signing and broadcast remain disabled. Standard non-rebasing ERC-20s are the only token model contemplated by this version. See `V7_CONSENT_BOUND_SPLITS.md`.

## Human-readable transaction simulations

The simulation schema makes irreversible V7 actions reviewable before wallet integration. Every receipt identifies the chain, actor, target, selector, calldata, zero native value, immutable commitments, expected state transition, risks and still-unverified live checks. Asset movements, token approvals and platform fees are explicit empty lists for these four calls.

Module intents are canonically ordered before release-freeze calldata is generated, preventing presentation order from silently changing the frozen module-manifest hash. Split recipients are canonically ordered before consent packets are created, while the deployment simulator preserves that signed positional order. TypeScript ABI decoding and independent Solidity calldata vectors pin all four calls.

The simulator does not read the chain and therefore cannot mark module activity, code identity, release state, creator identity, evidence validity or prior deployment as verified. Those checks remain fail-closed production blockers. See `V7_TRANSACTION_SIMULATIONS.md`.

The split-specific live verifier now performs those reads against a single block, rejects runtime or registry drift, recomputes the module key and manifests, checks prior deployment and requires the exact call—including recipient consent—to succeed through `eth_call`. Its successful receipt is still explicitly invalid for signing. Production anchors, finality policy, pre-wallet reverification, gas and balance checks remain blockers. See `V7_LIVE_STATE_VERIFICATION.md`.

## Governance boundary

The module registry requires its governance address to contain contract code. Production deployment is intended to use the existing delayed `RMTV6Governance`, not an EOA and not a new privileged owner.

Governance may:

- register a new exact module kind and version;
- permanently deactivate a module for future release freezes.
- rotate the media-evidence signer and advance its epoch.

Governance may not:

- change a registered module's address, code hash, interface, policy or metadata hash;
- reactivate an old version;
- edit, cancel or freeze a creator release;
- execute a registered module through either registry;
- create or alter evidence signed by the independent evidence signer;
- withdraw assets because the registries and verifier accept or hold none.

Registration means admitted to the RMT catalog. It is not an audit, safety guarantee, partnership claim or endorsement of a creator.

## Economics boundary

This increment records a `feePolicyHash`; it does not define or collect a fee.

- V6 token-market economics remain separate from V7 creator-marketplace economics.
- The current RMT token remains the only RMT token contemplated by the architecture. No relaunch is required or authorized.
- Creator and collaborator splits must apply to net creator proceeds, not secretly to the platform fee.
- Future protocol-fee collection must settle before any governed treasury allocation.
- Buybacks, burns, liquidity support, advertising, holder programs, project grants and NFT floor support remain separate, transparent governance actions.
- No source-level V7 registry function can execute a flywheel action.

See `V7_MARKETPLACE_ECONOMICS_BOUNDARY.md` for the accounting requirements that future settlement contracts must satisfy.

## Threat model and controls

| Threat | Current control | Remaining work |
| --- | --- | --- |
| EOA immediately admits malicious code | Governance must be a contract; production intends to use existing delayed governance | Verify deployed governance address and configuration |
| Implementation substitution | Address and `EXTCODEHASH` are permanently pinned | Future consumers must compare live code hash before execution |
| False interface claim | Registration requires ERC-165 support for ERC-165 and the declared interface | Independently test semantics; ERC-165 is not an audit |
| Governance rewrites a trusted version | Kind and version are append-only | Public monitoring and governance proposal simulation |
| Known-bad module remains selectable | Governance can permanently deactivate it | Define incident response timing and a narrowly scoped emergency policy if settlement requires it |
| Creator changes terms after collaborator approval | Rights, payout, fee, metadata and media hashes are immutable; the full module plan and short-lived media evidence freeze atomically | The future signing service must atomically recheck consent, decision, supersession and takedown state |
| Creator appends a dangerous module after freeze | Frozen plan cannot be changed | Corrections require a new release and new review |
| Duplicate module creates ambiguous behavior | Duplicate module keys in one release plan are rejected | Module-specific configuration validation belongs in reviewed module contracts |
| Registry accidentally holds user assets | No payable receive/fallback or withdrawal function; tests reject native transfers | Future token transfer mistakes require analysis because arbitrary ERC-20 transfers cannot be universally prevented |
| Registered module executes during release freeze | Release registry calls only the catalog's read-only `isModuleActive`; it never calls an implementation | Future factory/settlement contracts need reentrancy and execution tests |
| Creator freezes with an invented or unrelated receipt | Evidence signature binds exact release, creator, metadata, manifest, receipt and availability hashes | Protect and monitor the narrow evidence signer; publish signer epoch and rotation history |
| Old healthy observation is replayed | Maximum observation age is 24 hours and maximum validity is 48 hours from observation | Choose a stricter production policy if provider reliability requires it |
| Compromised evidence signer moves assets or mints | Signer has no contract authority beyond evidence validation; the creator still controls freeze and mint | Incident response must rotate the signer through delayed governance |
| Old signer remains trusted after rotation | Every message binds the current signer epoch; rotation invalidates old signatures | Ensure creators can request replacement evidence without rewriting commitments |
| Caller deploys a collection for another creator | Deployment verifies caller, module key and exact configuration against the frozen release | Product must clearly explain which wallet will own mint authority before signing |
| Creator mints metadata outside the reviewed release | Every sequential token ID and URI hash requires a Merkle proof from the frozen manifest | Pinning receipts and ongoing media availability still need to be wired into release review |
| Malicious receiver reenters during safe mint | Collection uses a mint guard and rolls back rejected receiver callbacks | Independent review and fuzzing remain required before deployment |
| Royalty percentage is misrepresented as guaranteed income | ERC-2981 is documented as signaling only and capped at 10% | UI and settlement must show actual marketplace behavior separately |
| Creator uses two valid leaves to expand one ERC-1155 ID | The first mint permanently binds the ID's URI, terms hash and supply ceiling; later mints must match | Review the complete manifest for duplicate IDs before freeze |
| Edition supply expands through repeated or alternate proofs | Per-ID and collection-wide lifetime counters never decrease and every mint is manifest-proven | Independent fuzzing and review remain required before deployment |
| Receiver callback leaves a partially registered edition | Minting is guarded; rejected callbacks revert URI registration and every supply counter | Include malicious receiver tests in every module version |
| A terms hash is presented as copyright ownership | Contracts and docs identify it only as a fingerprint of presented terms | Specialist review and plain-language collector presentation remain required |
| Creator assigns a collaborator without consent | Every split recipient signs the exact release, share, recovery and complete configuration | Production must atomically verify earlier collaborator consent has not been withdrawn before freeze |
| Creator swaps a recipient or recovery wallet after signing | Every field changes the EIP-712 digest; release freeze binds the exact configuration and payout hash | UI must render those fields plainly before wallet signing |
| Recipient contract rejects payment and blocks everyone | Pull payments isolate recipients; failed calls revert only that release attempt | Product should expose individual pending balances and recovery status |
| RMT or creator redirects collaborator proceeds | Split has no owner, administrator, arbitrary destination, sweep or upgrade function | Independent review must confirm no indirect redirect exists |
| Consent replays on another release or chain | Message and EIP-712 domain bind registry, release, creator, module and chain | Canonical address publication and live-chain verification remain required |
| Non-standard token breaks proportional accounting | Source explicitly limits compatibility to standard non-rebasing ERC-20s | Settlement must use an allowlist or exact received-amount verification |
| Fake registry deployment | Release registry requires a code-bearing module registry with code-bearing governance | Publish canonical addresses and deployment verification |
| “Registered” is misrepresented as “RMT approved” | Contract and docs explicitly separate admission, creator review and curation | UI language and public proof page must preserve the distinction |

## Tested invariants

`RMTV7ReleaseFoundation.t.sol` verifies:

- only governance can register or deactivate modules;
- code-less implementations and false ERC-165 claims fail;
- one kind and version cannot be overwritten;
- deactivation preserves history and cannot be repeated;
- creator nonces produce unique release IDs;
- only the creator can cancel or freeze a commitment;
- empty, duplicate, inactive and oversized module plans fail;
- freezing stores the expected manifest and never calls the implementation;
- frozen and cancelled releases cannot transition again;
- both registries and the evidence verifier reject native-asset custody;
- constructor dependencies must contain code.
- a freeze stores the exact evidence hashes, observation, expiry and signer epoch;
- invalid signer, stale, expired and future observations fail;
- only governance can rotate the evidence signer and old epochs fail immediately.

`RMTV7ERC721CollectionModule.t.sol` verifies:

- only the exact frozen creator and configuration can deploy;
- only one deterministic collection can be recorded for a release;
- inactive or substituted modules cannot deploy new collections;
- frozen release history survives module deactivation;
- creator minting is limited to the exact token-ID and URI manifest;
- wrong proofs, other creators and unsafe receivers cannot change supply;
- collection supply, metadata and royalty boundaries are enforced;
- both the module and deployed collection reject native-asset custody;
- the module advertises the reviewed interface and remains pinned to the registry entry.

`RMTV7ERC1155EditionModule.t.sol` verifies:

- only the exact frozen creator and configuration can deploy;
- one deterministic editions contract can be recorded for a release;
- module deactivation blocks deployment without rewriting frozen history;
- every ID, URI, terms hash and supply ceiling requires the frozen manifest proof;
- a second valid leaf cannot change a previously registered ID;
- per-ID, total and type-count limits cannot be exceeded;
- wrong proofs, other creators and unsafe receivers cannot change registration or supply;
- metadata, royalty and source-wide supply boundaries are enforced;
- module and editions contracts reject native-asset custody;
- the interface and implementation remain pinned to the registry entry;
- Solidity and TypeScript share fixed leaf, root and configuration-hash vectors.

`RMTV7ConsentBoundSplitModule.t.sol` verifies:

- exact EOA and ERC-1271 consent for every recipient;
- one immutable split per exact frozen release, configuration and payout manifest;
- native and ERC-20 lifetime pull-payment accounting;
- failed-recipient rollback and recipient-authorized recovery;
- creator, signer, expiry, replay, duplicate-recipient and share-total failures;
- inactive module and dishonest direct-deployment failures;
- absence of module custody or an invalid advertised interface;
- shared Solidity and TypeScript configuration vectors.

## Next contract increments

The following order keeps risk bounded:

1. select and approve a real V7 fee policy;
2. extend the human-readable simulator and live read-only verifier to split deployment;
3. implement fixed-price settlement with expiry, cancellation, narrow approvals and adversarial asset/payment tests;
4. add offers only after fixed-price settlement is proven;
5. consider auctions last.

Every executable increment still requires specialist review, public deployment artifacts and explicit authorization before a testnet or mainnet transaction.
