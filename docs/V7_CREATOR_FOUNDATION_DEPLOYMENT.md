# V7 creator foundation deployment

Status: source-complete, locally rehearsable, production deployment locked

Last verified: August 2, 2026

Deployment: none

Independent audit: none

## What is ready

The deployable V7 creator foundation contains:

1. an append-only module registry governed by RMT's existing delayed V6 governance;
2. a bounded EIP-712 media-evidence verifier with a rotatable evidence-only signer;
3. an immutable creator release registry;
4. a creator-controlled ERC-721 collection module;
5. a creator-controlled ERC-1155 editions module;
6. a unanimous consent-bound collaborator split module; and
7. a size-bounded core bundle that atomically deploys and verifies the registry layer; and
8. a size-bounded module bundle that atomically deploys and verifies the three inactive creator modules.

Neither deployment stage can register modules, mint assets, freeze releases, move funds, list items, charge a fee, upgrade a contract or call an administrator function. All three creator modules remain inactive after both stages. Admission requires separate calls through the existing delayed governance contract.

## Deployment graph

```text
existing RMT V6 delayed governance
                 |
        +--------+---------+
        |                  |
module registry     media evidence verifier
        |                  |
        +--------+---------+
                 |
          release registry
                 |
        +--------+---------+
        |        |         |
     ERC-721  ERC-1155  consent split
      module    module      module
```

`RMTV7CreatorFoundationCoreBundle` creates the registry, evidence verifier and release registry atomically. `RMTV7CreatorFoundationModulesBundle` then creates the ERC-721, ERC-1155 and split modules atomically against that exact core. Every immutable binding is checked inside the relevant constructor.

Two transactions are required because a one-transaction bundle compiles to 52,427 bytes of initcode, which exceeds the EIP-3860 limit of 49,152 bytes. The split design keeps both transactions within the protocol limit. A core-only partial deployment is inert: it has no registered modules, cannot mint, cannot settle trades and cannot move funds. The second stage is source-locked to the reviewed core addresses through the deployment manifest.

## Production lock

`DeployRMTV7CreatorFoundation.s.sol` is intentionally disabled by a zero `APPROVED_DEPLOYMENT_MANIFEST_HASH`. Environment variables cannot bypass this lock.

The final reviewed manifest binds:

- Robinhood Chain ID `4663`;
- the deploying wallet;
- the expected core and module-bundle addresses and deployer nonce;
- the existing RMT V6 governance address;
- the bounded media-evidence signer;
- the exact creation code for both stages; and
- the complete constructor init code for both stages.

Unlocking requires a reviewed source change that inserts one exact manifest hash, reruns the full suite, and receives separate deployment authorization. The deployer private key and evidence signer are environment inputs only; neither belongs in source control.

## Current governance anchor

The existing V6 governance anchor was read directly from the official Robinhood Chain RPC at block `26355113` (block hash `0xf9b421ff096e48dcf9fd85ce85f74babddd27309ecc4dcdaad911c8e975af2ba`) on August 3, 2026 UTC:

- chain ID: `4663`;
- governance: `0x52c43239dF8965EB27F26E115Cc5EAD11B35d5C3`;
- runtime code hash: `0x85bc5b5b878054e5c6aafa667f896e29a91e4748d762a569d27d706886252dc0`;
- execution delay: 86,400 seconds;
- execution window: 604,800 seconds;
- signer count: 1;
- threshold: 1; and
- configuration epoch: 1.

This is a read-only verification snapshot, not a deployment approval. It must be repeated at the final deployment block.

## Two-step activation

Deployment does not activate creator execution.

After source verification, RMT governance must separately propose three `registerModule` calls with reviewed policy and metadata hashes. The existing governance delay and execution window apply. Only after those proposals mature and execute can a creator freeze a release using the admitted module versions.

This separation gives RMT time to verify:

- explorer source verification and runtime hashes;
- every immutable topology binding;
- the evidence signer's limited operating policy;
- the public module policy documents and hashes;
- the UI's reviewed anchor manifest; and
- incident monitoring before creator execution is enabled.

## Required deployment sequence

1. Complete an independent audit of the six foundation contracts and both deployment bundles.
2. Select the production media-evidence signer and document its key custody and rotation procedure.
3. Freeze the three public module-policy documents and compute their hashes.
4. Compute the deployer nonce, both expected bundle addresses and the deployment manifest.
5. Insert the exact approved manifest hash in source and rerun CI, Slither, full Foundry tests, contract sizes and a mainnet fork rehearsal.
6. Obtain explicit authorization for the deployment transaction.
7. Deploy the core bundle, verify its four sources and confirm its immutable bindings on Blockscout.
8. Deploy the module bundle against that exact core, verify its four sources and confirm all modules remain inactive.
9. Publish both deployment receipts and all runtime hashes while modules remain inactive.
10. Submit the three delayed governance registration proposals.
11. After the delay, re-verify runtime and policy hashes, execute the proposals and publish the activation receipts.
12. Enable read-only V7 verification in RMT first.
13. Run a bounded creator canary before exposing general creator deployment controls.

## Remaining blockers

- independent smart-contract audit;
- an approved production evidence signer and operating policy;
- final module policy and metadata documents;
- final deployer nonce and funded deployment wallet;
- a nonzero reviewed deployment-manifest hash;
- explorer verification rehearsal;
- production monitoring and incident response;
- explicit deployment authorization; and
- separate module-registration and product-enablement approvals.

Marketplace settlement, buyer payments, listings, auctions, platform fees and token-directed treasury actions are outside this foundation and require separate contracts and review.
