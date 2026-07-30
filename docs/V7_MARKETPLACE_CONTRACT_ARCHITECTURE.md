# V7 marketplace contract architecture

Status: source-level foundation only

Date: July 29, 2026

Deployment: none

Audit: none

## Outcome

The first V7 contract increment establishes two narrow registries:

1. `RMTV7ModuleRegistry` is an append-only catalog of exact implementation, interface, code, metadata and policy fingerprints admitted by RMT's delayed governance.
2. `RMTV7ReleaseRegistry` lets a creator commit an immutable release revision and atomically freeze the complete set of future modules and configurations associated with it.

Neither registry mints, lists, transfers, approves, charges, settles, routes fees, calls an implementation module, holds funds, buys RMT, burns RMT, purchases NFTs or claims that RMT approved a creator.

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
    | creator atomically supplies 1-8 active module intents
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
- creation, freeze and cancellation timestamps;
- creator-scoped nonce and state.

The release ID includes the chain ID and registry address. An identical payload committed on another chain or deployment produces a different ID.

## Governance boundary

The module registry requires its governance address to contain contract code. Production deployment is intended to use the existing delayed `RMTV6Governance`, not an EOA and not a new privileged owner.

Governance may:

- register a new exact module kind and version;
- permanently deactivate a module for future release freezes.

Governance may not:

- change a registered module's address, code hash, interface, policy or metadata hash;
- reactivate an old version;
- edit, cancel or freeze a creator release;
- execute a registered module through either registry;
- withdraw assets because neither registry accepts or holds them.

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
| Creator changes terms after collaborator approval | Rights, payout, fee, metadata and media hashes are immutable; full module plan freezes atomically | Wire collaborator acceptance and provider receipts to the same hashes |
| Creator appends a dangerous module after freeze | Frozen plan cannot be changed | Corrections require a new release and new review |
| Duplicate module creates ambiguous behavior | Duplicate module keys in one release plan are rejected | Module-specific configuration validation belongs in reviewed module contracts |
| Registry accidentally holds user assets | No payable receive/fallback or withdrawal function; tests reject native transfers | Future token transfer mistakes require analysis because arbitrary ERC-20 transfers cannot be universally prevented |
| Registered module executes during release freeze | Release registry calls only the catalog's read-only `isModuleActive`; it never calls an implementation | Future factory/settlement contracts need reentrancy and execution tests |
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
- both registries reject native-asset custody;
- constructor dependencies must contain code.

## Next contract increments

The following order keeps risk bounded:

1. define module interfaces and human-readable transaction simulation schemas;
2. implement a creator-controlled ERC-721 collection module with no marketplace settlement;
3. implement an ERC-1155 edition module with explicit supply invariants;
4. implement consent-bound pull-payment splits with failed-recipient recovery;
5. select and approve a real V7 fee policy;
6. implement fixed-price settlement with expiry, cancellation, narrow approvals and adversarial asset/payment tests;
7. add offers only after fixed-price settlement is proven;
8. consider auctions last.

Every executable increment still requires specialist review, public deployment artifacts and explicit authorization before a testnet or mainnet transaction.
