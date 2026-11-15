# RMT Operations Safe preparation

[Issue #619](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/619) approves the Operations owner policy for preparation. This work is stacked on [draft #618](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/618) at `0611b8aeaee0ab882345e0391c0a5051634163ca` for [release preparation #611](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/611). Its status is **BLOCKED_NO_BROADCAST**.

## Approved Operations policy

Use **SafeL2 1.4.1** on Robinhood Chain **4663** with two approvals from these three owners.

| Owner | EIP-55 address |
| --- | --- |
| RMT-GOV-01 | `0xC447A378cFd8460Febc2eef67501D7a5473B9001` |
| RMT-GOV-02 | `0xC3600f2Df60929D2AB9ab294CFF42EEDCB984f51` |
| RMT-GOV-03 | `0x2Bcc3fAfCE77cCc7fdBED46E0B5bb80bA3E76697` |

The owner reports separately backed up keys held on one phone. A single loss or compromise can affect multiple approvals. RPC observations establish account eligibility at their recorded blocks. Actual Rabby key control and phone signing remain unverified. [Approved Operations policy](evidence/rmt-task045/operations-safe-policy.json) · [Task 044 governance evidence](evidence/rmt-task044/governance-wallets.json)

Operations receives all factory creation fees and its existing 5% share of eligible curve and original-position LP fees. Reserve keeps its separate 5% allocation with its owner set, threshold, gas payer, salt and address all unassigned. Each project's 90% allocation and permanent LP principal lock remain as specified in the frozen contracts. Both Safe addresses are unassigned in the canonical release sheet. [Treasury and claim evidence](evidence/rmt-task045/4663-operations-safe-rehearsal.json) · [Canonical release inputs](evidence/rmt-task041-closeout/owner-inputs.json)

## Verification and replay

- **Governance observations.** Pocket and Pinax independently reproduced the earlier owner summary's block **115080843** and returned empty code for all three addresses. The official RPC returned the same header but no longer serves that block's account state. Task 044's earlier committed observations at **114738660** and **114745436** are separate checks. [Archived replay and exact RPC provenance](evidence/rmt-task045/governance-115080843.json) · [Task 044 observations](evidence/rmt-task044/governance-wallets.json)
- **Initializer.** Encoding and decoding the exact approved owner order produced **420 bytes** with Keccak-256 `0x151a0612bf013560eaf16129615ae6262a6889db13410623ddcb49f2a8506ac2`. The factory, singleton and compatibility handler matched the pinned runtimes at official block **115110122**. The separate illustrative CREATE2 salt used synthetic owners. Its derived address had empty code and nonce zero at that block, and a read-only factory call returned the same address. This fixture has no bearing on the pending production salt or beneficiary. [Initializer and fixture observation](evidence/rmt-task045/operations-safe-initializer.json)
- **Synthetic fork.** A fresh Anvil 1.7.1 run on loopback used Pinax at block **114549452**, hash `0xf9a8ca5d8e26ebb426ebd2e663ad82afc878c16d8bba5f5542f6341890cf7710`. Upstream writes were rejected with HTTP 403. The frozen candidate exercised signer rotation, same-token migrations, failed graduation recovery, official v4 trades, LP claims and permanent custody. [Fork receipts and compiler input](evidence/rmt-task045/4663-operations-safe-rehearsal.json)
- **Claims and spending.** Two synthetic Operations owners authorized curve ETH and combined or single-asset LP claims, plus outgoing ETH and ERC-20 transfers. One signature failed with `GS020` and replay failed with `GS026`. The exact **0.0004 ETH** creation fee reached Operations only. The fixture verified the two separate 5% allocations and the project's 90% share, including rounding. Reserve's 3-of-3 policy existed only in that synthetic rehearsal. [Fork receipts](evidence/rmt-task045/4663-operations-safe-rehearsal.json)
- **Cost.** The synthetic Operations Safe creation used **305,811 gas**. Task 044's separate read-only synthetic estimate was **313,391 gas** or **0.000006274714602 ETH** at the observed gas price. Re-estimate with the approved deployment inputs, gas payer and current L1 data fees before any separate creation approval. [Cost provenance](RMT_CURVE_TASK044_SAFE_INFRASTRUCTURE.md#gas-estimates)

From this checkout, set the dependency checkout to the pinned #594 worktree at `8dca5773cbd4dc98f52a45616f420bce96b000f0`. The optional `--observe-fixture` performs read-only checks at a fresh block with a synthetic address. The fork command uses the checksum-verified pinned tools and libraries.

```powershell
$env:RMT_DEPLOYMENT_TEST_CHECKOUT = "../rmt-task026-acceptance"
$anvil = "C:/path/to/anvil.exe"
$solc = "C:/path/to/solc-0.8.26.exe"
node --test docs/evidence/rmt-task045/operations-safe-initializer.test.mjs
node docs/evidence/rmt-task045/operations-safe-initializer.mjs --checkout $env:RMT_DEPLOYMENT_TEST_CHECKOUT --observe-fixture
node docs/evidence/rmt-task044/run-platform-safe-fork.mjs --checkout $env:RMT_DEPLOYMENT_TEST_CHECKOUT --anvil $anvil --solc $solc --lib packages/contracts/lib --archive pinax
node docs/evidence/rmt-task041-closeout/verify-release.mjs
```

## Phone readiness checklist

The hosted Robinhood creation route and Safe's network configuration returned HTTP 200 at 2026-11-15 16:56 UTC. The configuration lists chain 4663, recommends **1.5.0** and disables `safeMobile` and `walletConnect`. The actual Rabby mobile connection and 1.4.1 selector remain unverified. [Safe Wallet creation route](https://app.safe.global/new-safe/create?chain=robinhood) · [Safe chain configuration](https://safe-client.safe.global/v1/chains/4663/) · [Rabby mobile project](https://github.com/RabbyHub/rabby-mobile)

1. In the installed Rabby app, check the public address shown for each of the three owner labels using the table above. Keep recovery materials in their existing private backup locations. For a network check, compare Rabby's network display with Robinhood's published configuration, including chain ID **4663**, symbol **ETH** and the official RPC. Use an ordinary browser to check whether the hosted Safe network and version are offered. Stop at the connection or signing prompt for this preparation task. [Official wallet network settings](https://docs.robinhood.com/chain/add-network-to-wallet/)
2. For a later separately authorized device check, open the official Safe Wallet origin in Rabby's in-app browser if it offers a supported Rabby connector. Verify the connected full owner address and chain after each account switch. Use the verified Operations Safe address once assigned. Any switch to the hosted default 1.5.0 would require a separately reviewed change to the approved profile.
3. For each of the two distinct owners in a future acceptance run, compare the same EIP-712 domain and Safe transaction hash with the reviewed transaction. Verify chain ID, Safe address, destination, decoded calldata, asset and amount, ordinary `CALL`, current Safe nonce and the agreed gas/refund fields. A claim uses a Safe transaction value of zero. An ETH transfer uses the approved amount as the value. An ERC-20 transfer uses the token contract and the approved recipient and amount in the decoded calldata. Stop on an unexpected prompt or an undecodable request. [Safe transaction review in Rabby](https://help.safe.global/articles/2485383995-how-to-perform-basic-transactions-checks-on-safewallet) · [Safe owner confirmation rules](https://docs.safe.global/advanced/smart-account-concepts)
4. In the authorized run, verify the first confirmation leaves the proposal below the threshold. Verify the second confirmation belongs to a different listed owner and covers the same Safe transaction hash and nonce. A duplicate or changed proposal cannot count as the second confirmation. On-chain execution needs its own authorization, executor and gas payer. Reconcile the Safe transaction hash with the outer transaction receipt and exact ETH or ERC-20 settlement. [Safe Transaction Service confirmation model](https://docs.safe.global/core-api/api-safe-transaction-service)

## If the hosted flow is unavailable

If Robinhood 4663, Rabby mobile or SafeL2 1.4.1 is unavailable in the hosted flow, use Safe's documented Protocol Kit as an unsigned preparation path. Select chain 4663, `safeVersion: "1.4.1"`, `deploymentType: "canonical"` and `isL1SafeSingleton: false`. Verify the resolved factory, singleton and compatibility handler against the runtime pins. Use `createSafeDeploymentTransaction()` to prepare and inspect the call. Compare the destination, value and complete calldata to the reviewed `createProxyWithNonce` call before any later authorization. [Pinned Safe runtimes](RMT_CURVE_TASK044_SAFE_INFRASTRUCTURE.md#runtime-and-hosted-evidence) · [Official unsigned transaction builder](https://docs.safe.global/reference-sdk-protocol-kit/deployment/createsafedeploymenttransaction) · [Official version and deployment configuration](https://docs.safe.global/reference-sdk-protocol-kit/initialization/init)

Once each salt has separate approval, compare the two derived addresses and check their code and nonces for vacancy in the latest and pending chain states. The initializer tooling demonstrates the derivation with an illustrative salt. The production salt and Operations beneficiary remain unassigned. [Initializer verification](evidence/rmt-task045/operations-safe-initializer.mjs)

For later authorized signing, a reviewed Safe Protocol Kit integration with an owner-controlled compatible wallet provider can carry the same EIP-712 request. Test the chosen provider on an isolated fixture if the hosted phone connector is unavailable. Key material stays with the owner. If the provider cannot display and verify the exact approved payload, device acceptance remains open. A synthetic fork pass proves the contract's signature and settlement behavior with its test keys. [Safe transaction signature reference](https://docs.safe.global/reference-sdk-protocol-kit/transaction-signatures/signtransaction)

## Remaining owner decisions and release gates

1. Choose Reserve owners, threshold and version independently. Confirm an approved salt and a gas payer for each Safe, plus any execution or reimbursement policy.
2. Get separate creation approval. After actual creation, verify both distinct on-chain addresses, the proxy and singleton, owner set, threshold, compatibility handler, empty module list, zero guard, and ETH and ERC-20 receipt and claim paths. Enter verified addresses in the canonical owner sheet only after those checks pass.
3. Supply the dedicated deployer's public address, explicitly approve the final economics, and assign signer continuity, recovery and incident responsibilities.
4. Resolve the exact 4663 Slither gate and confirm production archive and trace capacity, independent Ethereum L1 finality, durable indexing and recovery, exact-pool hosted routing and physical-wallet acceptance. Contract deployment, funded acceptance and public activation each require a separate authorization. [Release closeout and approval points](RMT_CURVE_TASK041_RELEASE_CLOSEOUT.md)

The release gate remains **FAIL_HIGH** with **22 unresolved high findings**, including 18 active-engine and four dependency findings. The frozen contract candidate is `d4d81d1153a11728d98e694c1f3976ceb3408915`. [Exact release manifest](evidence/rmt-task041-closeout/release-manifest.json)
