# V7 Creator Transaction Simulations

Status: source-level preparation only

Schema: `creator-v7-transaction-simulation` version 1

Wallet signing: disabled

Broadcasting: disabled
Deployment: not authorized

## Purpose

RMT must explain an irreversible creator transaction before asking a wallet to sign it. The V7 simulation builder prepares the exact calldata and a plain-language receipt for:

1. freezing a committed creator release;
2. deploying its frozen ERC-721 collection;
3. deploying its frozen ERC-1155 editions contract.

The receipt is deterministic and fingerprinted. It is not a chain read, an execution estimate, an audit, a wallet signature or proof that the transaction would currently succeed.

## Common receipt

Every simulation contains:

- schema version and simulation ID;
- action, chain, expected actor and risk level;
- target contract, function selector, complete calldata and zero native value;
- human-readable commitments and irreversible state changes;
- explicit empty asset-movement, token-approval and platform-fee lists;
- live checks that remain `required_unverified`;
- warnings and execution limitations;
- `contractExecution: disabled`.

The simulation ID fingerprints the complete normalized receipt. Any change to the chain, actor, target, calldata, explanation, warning or required check changes the ID.

## Release freeze

The freeze simulation:

- validates one to eight unique nonzero module intents;
- sorts module intents by module key so UI ordering cannot silently change the calldata;
- derives the same order-sensitive module-manifest hash used by `RMTV7ReleaseRegistry`;
- validates the 65-byte media-evidence signature;
- rejects future, stale, expired and overlong evidence windows;
- displays every module key and configuration hash;
- states that the committed release becomes terminally frozen;
- shows that freezing moves no assets, grants no approval, charges no fee and deploys nothing.

Immediately before signing, an eventual execution surface must independently verify:

- connected chain and creator wallet;
- release state;
- exact release-registry address and runtime;
- every active module's implementation, interface and runtime code hash;
- evidence signer epoch, signature and expiration;
- exact calldata equality with the displayed simulation.

## ERC-721 deployment

The ERC-721 simulation validates and displays:

- exact module and module key;
- release and creator;
- collection name, symbol and collection URI;
- token-manifest root;
- lifetime supply ceiling;
- royalty receiver and basis-point signal;
- Solidity-compatible configuration hash;
- exact `deployCollection` calldata.

It states that deployment does not mint, list, approve, sell or transfer an NFT. It also states that ERC-2981 is a preference signal and cannot guarantee royalty payment.

## ERC-1155 deployment

The ERC-1155 simulation consumes the deterministic edition manifest and displays:

- exact module and module key;
- release and creator;
- collection identity and URI;
- edition-manifest root;
- maximum edition types and lifetime minted units;
- royalty receiver and basis-point signal;
- Solidity-compatible configuration hash;
- exact `deployEditions` calldata.

It states that deployment does not mint, list, approve, sell or transfer an edition. A terms hash is described only as provenance evidence, not proof of copyright or a legal grant.

## Cross-layer vectors

`creator-v7-transaction-simulation-smoke.ts` decodes every generated call and pins:

- function selectors;
- calldata hashes;
- configuration hashes;
- deterministic simulation IDs;
- canonical module ordering.

`RMTV7TransactionSimulationVectors.t.sol` independently constructs the same three calls in Solidity and pins the same selectors, calldata hashes and configuration hashes.

The tests also reject duplicate modules, expired evidence, malformed signatures, inconsistent royalties and changed execution context.

## Security boundary

The builder intentionally performs no RPC call. A deterministic receipt must not misrepresent caller-supplied context as verified chain state.

Before any wallet integration, RMT still needs a separate read-only verifier that pins the chain block, contract addresses, runtime hashes, active module entries, release creator and state, existing deployment status, evidence epoch and exact calldata. The wallet action must fail closed if any result changes between simulation and signing.

No production V7 address, signer, executor, gas estimate or transaction route is enabled by this increment.
