# Helium RWA evidence registry V0 — testnet deployment runbook

**Status:** PRE-BROADCAST PREPARATION ONLY  
**Target:** Robinhood Chain testnet (`chainId 46630`)  
**Current authorization:** no deployment, no broadcast, no merge, no public release

## Purpose

This runbook defines the controlled path from the synthetic contract proof to a separately authorized Robinhood Chain testnet deployment. It does not itself authorize or perform a transaction.

The deployed contract, if later approved, would remain a synthetic evidence demonstration. It would create no helium ownership, commodity title, custody right, redemption right, transferable instrument, token, price, fee, revenue right, or RMT-token entitlement.

## Required public inputs

Before a final deployment plan can be frozen, the owner must approve two public addresses:

1. `ADMINISTRATOR_ADDRESS` — the address permitted to register synthetic parties, configure the synthetic instrument, and apply administrative evidence states.
2. `DEPLOYER_ADDRESS` — the address that will submit and pay for the one testnet deployment transaction.

No seed phrase, raw private key, mnemonic, or wallet-export material belongs in the repository, issue, pull request, manifest, shell history, CI secret, or chat.

## Source-freeze gate

Immediately before any final plan is produced:

1. confirm the exact PR head and current `main`;
2. ensure the feature branch is not behind `main`;
3. require every latest-head workflow to be green;
4. record the exact source commit in a copy of `rmt-commodity-evidence-registry-v0-readiness.template.json`;
5. confirm the diff remains isolated to the evidence-registry tranche;
6. prohibit source changes after bytecode commitments are approved.

A source change invalidates every prior creation-code, init-code, runtime-code, domain-separator, gas, and verification commitment.

## Read-only RPC preflight

From `packages/contracts`, using an approved testnet RPC endpoint and the approved public administrator address:

```bash
export RPC_URL='https://approved-robinhood-testnet-rpc.example'
export ADMINISTRATOR_ADDRESS='0x0000000000000000000000000000000000000000'
./scripts/preflight-commodity-evidence-registry-v0.sh
```

The zero address shown above is an intentional placeholder and will be rejected. The command:

- confirms RPC chain ID `46630`;
- validates the fail-closed manifest template;
- formats, builds, and tests the isolated contract tranche;
- simulates deployment through `PrepareCommodityEvidenceRegistryV0Deployment`;
- emits the administrator-specific creation, init, runtime, and EIP-712 domain commitments;
- submits no transaction.

The preflight script contains no broadcast flag or signing-secret interface.

## Deployment-plan commitments

Copy the readiness template to a commit-specific, untracked working file and populate only after a successful preflight:

```text
source.commit
actors.administrator
actors.deployer
bytecode.creationCodeHash
bytecode.administratorBoundInitCodeHash
bytecode.administratorBoundRuntimeCodeHash
bytecode.expectedDomainSeparator
bytecode.creationCodeSize
bytecode.initCodeSize
bytecode.runtimeCodeSize
```

Keep all authorization values `false` and deployment status `UNDEPLOYED` until the owner separately approves the exact plan.

The runtime-code hash depends on the administrator because the administrator is immutable. The domain separator also depends on the final deployed contract address, so the final expected domain separator cannot be frozen until the deployment address is deterministically known from the approved deployer and nonce or until the transaction is mined. Do not substitute a simulated contract's domain separator for the final address.

## Deployer and nonce gate

Immediately before a future authorized broadcast:

1. read the approved deployer's pending nonce from the target RPC;
2. compute the expected CREATE address from the deployer and nonce;
3. verify the address has no existing code;
4. confirm the nonce has not changed;
5. record the nonce and expected address in the deployment plan;
6. re-simulate against the exact source head and constructor argument;
7. obtain a separate explicit owner authorization naming the chain, source commit, administrator, deployer, nonce, expected address, init-code hash, and maximum gas cost.

Any nonce change cancels the approval and requires a new expected address and domain separator.

## Signing boundary

The eventual transaction must be signed through a controlled wallet or approved signer. The engineering package must never request or expose the secret itself.

Before signature, the human-readable transaction review must show:

- network: Robinhood Chain testnet;
- chain ID: `46630`;
- action: contract creation;
- constructor argument: exact administrator address;
- value: zero;
- init-code hash: exact approved value;
- predicted contract address: exact approved value;
- gas limit and maximum fee;
- no follow-on calls bundled into the deployment.

There is no authorization in this runbook to add a broadcast flag or submit the transaction.

## Post-deployment read-only verification

After a separately authorized and mined testnet deployment, populate the expected values and run:

```bash
export RPC_URL='https://approved-robinhood-testnet-rpc.example'
export REGISTRY_ADDRESS='0x0000000000000000000000000000000000000000'
export EXPECTED_ADMINISTRATOR='0x0000000000000000000000000000000000000000'
export EXPECTED_RUNTIME_CODE_HASH='0x0000000000000000000000000000000000000000000000000000000000000000'
export EXPECTED_DOMAIN_SEPARATOR='0x0000000000000000000000000000000000000000000000000000000000000000'
./scripts/verify-commodity-evidence-registry-v0-deployment.sh
```

The placeholders intentionally fail. The verifier performs only RPC reads and checks:

- chain ID;
- code presence;
- exact runtime-code hash;
- immutable administrator;
- testnet target-chain constant;
- synthetic-only constant;
- exact EIP-712 domain separator;
- no-rights and non-transferable policy commitments;
- absence of a successful mint interface.

## Source verification

Confirm the current official Robinhood Chain testnet explorer and Blockscout-compatible API endpoint at execution time. Do not trust an endpoint copied from an old document or social post.

A representative Foundry verification shape is:

```bash
export BLOCKSCOUT_API_URL='https://confirmed-official-blockscout-api.example/api/'
CONSTRUCTOR_ARGS="$(cast abi-encode 'constructor(address)' "$EXPECTED_ADMINISTRATOR")"

forge verify-contract \
  "$REGISTRY_ADDRESS" \
  src/RMTCommodityEvidenceRegistryV0.sol:RMTCommodityEvidenceRegistryV0 \
  --chain-id 46630 \
  --constructor-args "$CONSTRUCTOR_ARGS" \
  --verifier blockscout \
  --verifier-url "$BLOCKSCOUT_API_URL" \
  --watch
```

Use the exact compiler and optimizer settings from the frozen Foundry build. Successful source verification does not authorize evidence publication or public release.

## Synthetic configuration sequence

Contract deployment and synthetic configuration are separate transactions. A later demonstration would require separate approval for each exact call:

1. deploy the registry with the approved administrator;
2. register the synthetic issuer signing address;
3. register the synthetic custodian signing address;
4. register the synthetic attestor signing address;
5. configure the synthetic helium instrument;
6. build one registry-address-specific EIP-712 evidence package;
7. obtain the three synthetic role signatures;
8. publish the synthetic evidence package;
9. verify the stored and effective status through RPC and explorer logs.

The current authorization reaches none of those transactions. The existing rehearsal proves the sequence only inside Foundry simulation.

## Stop conditions

Stop immediately and invalidate the plan if any of the following occurs:

- RPC chain ID is not `46630`;
- source head changes;
- `main` advances and the branch has not been reviewed against it;
- any required workflow is not green;
- administrator, deployer, or nonce changes;
- creation, init, or runtime hash differs;
- predicted address already contains code;
- gas or fee exceeds the approved ceiling;
- wallet review shows nonzero value or bundled calls;
- explorer verification does not reproduce the deployed bytecode;
- any language suggests real inventory, title, backing, redemption, Robinhood endorsement, or token issuance;
- any signing secret appears in logs, files, environment output, or chat.

## Remaining authorization gates

Separate explicit owner authorization is still required for each of the following:

- freezing administrator and deployer addresses;
- broadcasting the testnet deployment;
- registering synthetic parties;
- configuring the synthetic instrument;
- publishing synthetic evidence;
- merging the pull request;
- connecting a UI;
- making a public demonstration or announcement;
- contacting Robinhood, a producer, custodian, laboratory, attestor, or other partner;
- introducing real inventory or any token/economic mechanism.
