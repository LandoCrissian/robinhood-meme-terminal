# RMT Operations and Reserve Safes

Both treasury policies are **approved for unsigned preparation and synthetic fork testing**. Your three existing Rabby accounts cover both Safes. Each Safe uses **2-of-3** on Robinhood Chain **4663**, with **SafeL2 1.4.1**. This work starts from draft #620 at `613c438151004dc7ba3bf561d6b221b4434ed22d`. [Owner decision #621](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/621) · [Release preparation #611](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/611)

| Owner | Public EIP-55 address for both Safes |
| --- | --- |
| RMT-GOV-01 | `0xC447A378cFd8460Febc2eef67501D7a5473B9001` |
| RMT-GOV-02 | `0xC3600f2Df60929D2AB9ab294CFF42EEDCB984f51` |
| RMT-GOV-03 | `0x2Bcc3fAfCE77cCc7fdBED46E0B5bb80bA3E76697` |

Operations receives all factory creation fees and its existing 5% share of eligible curve and original-position LP fees. Reserve receives its separate 5% share. Each Safe will use its own address, balance, transaction nonce and beneficiary credits. Track each treasury's claims and spending separately. A transfer between them would need a separately approved transaction from the sending Safe. Each project keeps its 90% entitlement and its LP principal remains locked. The example salt pair and derived addresses are unsigned preparation evidence. The final salts and canonical treasury addresses remain pending. [Operations policy](evidence/rmt-task045/operations-safe-policy.json) · [Reserve policy](evidence/rmt-task046/reserve-safe-policy.json) · [Unsigned initializer evidence](evidence/rmt-task046/treasury-safe-initializers.json)

The owner reports separate backups for accounts held on one phone. The same two keys can authorize spending from both Safes and participate in RMT directory governance. A device compromise can therefore affect all three roles. For a future authorized owner rotation, each Safe requires its own approval and transaction, bound to its own address and nonce. Rotating one Safe changes only that Safe's owner list and leaves its beneficiary address in place. Rotation in the RMT directory follows its separate governance procedure. Unavailable keys can prevent rotation if fewer than two owners can approve. [Safe owner rotation](https://docs.safe.global/reference-sdk-protocol-kit/safe-info/createswapownertx) · [RMT governance rotation](RMT_CURVE_TASK043_GOVERNANCE_ROTATION.md)

## Verification and replay

The frozen protocol deploys one curve fee ledger and one LP fee ledger per launch. Each ledger has separate beneficiary slots, credits and settlements for Operations and Reserve. The two treasuries have independent Safe custody accounts.

Both policies produce the same 420-byte initializer with the canonical fallback handler, zero setup payment, no delegatecall, no modules and zero guard. Two role-specific salt proposals produce distinct CREATE2 addresses. The official Robinhood RPC matched both predictions with `eth_call` and returned empty code and zero nonce for both at block **115122924**, hash `0x2c65a6c5c96d9932027628d5214d1b1bfce0130a20298d989b3ac690711a0a4f`. Recheck both at latest and pending before any separately approved creation. The proposals are unapproved and the canonical beneficiary input fields remain empty. [Initializer and RPC evidence](evidence/rmt-task046/treasury-safe-initializers.json)

The fresh synthetic fork used Pinax at block **114549452**, hash `0xf9a8ca5d8e26ebb426ebd2e663ad82afc878c16d8bba5f5542f6341890cf7710`. Writes stayed on loopback. The archive relay rejected the write probe with HTTP 403. Both synthetic Safes deployed at their independently derived addresses and each used **305,823 gas**. Their shared synthetic owners exercised separate curve claims, combined and single-asset LP claims, and ETH and ERC-20 spending. One signature failed with `GS020`. Both ordinary replay and attempts to use a valid signature pair on the other Safe at the same nonce failed with `GS026`.

Each Safe independently authorized a native `swapOwner` call. The removed owner then failed to co-authorize a new call, and the replacement succeeded with a retained owner. Each rotation preserved the other Safe's owners, threshold and nonce. The fork also preserved both treasury balances across rotation, exact creation-fee payment to Operations alone, the 90/5/5 fee accounting and locked LP principal. Those results apply to the synthetic fixture identities. [Fork receipts and runtime provenance](evidence/rmt-task046/4663-shared-owner-safe-rehearsal.json) · [SafeL2 owner-management source](https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/OwnerManager.sol#L85-L105)

From this checkout, set the dependency checkout to the pinned #594 worktree at `8dca5773cbd4dc98f52a45616f420bce96b000f0`, with the pinned dependencies installed. Use Anvil 1.7.1 and the checksum-verified native Solidity 0.8.26 compiler. The optional observation flag runs fresh public read-only checks with the approved public owner list and unapproved salt proposals. The separate fork command uses synthetic keys and synthetic ETH on loopback.

```powershell
$env:RMT_DEPLOYMENT_TEST_CHECKOUT = "../rmt-task026-acceptance"
$anvil = "C:/path/to/anvil.exe"
$solc = "C:/path/to/solc-0.8.26.exe"
node --test docs/evidence/rmt-task046/treasury-safe-initializers.test.mjs
node docs/evidence/rmt-task046/treasury-safe-initializers.mjs --checkout $env:RMT_DEPLOYMENT_TEST_CHECKOUT --observe-salt-proposals
node docs/evidence/rmt-task046/run-shared-owner-safe-fork.mjs --checkout $env:RMT_DEPLOYMENT_TEST_CHECKOUT --anvil $anvil --solc $solc --lib packages/contracts/lib --archive pinax
node docs/evidence/rmt-task041-closeout/verify-release.mjs
```

## Phone acceptance

The hosted Safe creation route and the chain metadata returned HTTP 200 at 2026-11-15 17:21 UTC. The metadata lists Robinhood Chain 4663, recommends **1.5.0**, and disables `safeMobile` and `walletConnect`. The 1.4.1 selector, Rabby mobile connection, and real-key control require later verification. If the approved profile is unavailable in the hosted flow, use the unsigned Protocol Kit path pinned to 1.4.1. That path leaves physical-wallet acceptance open. [Safe creation route](https://app.safe.global/new-safe/create?chain=robinhood) · [Safe chain metadata](https://safe-client.safe.global/v1/chains/4663/) · [Unsigned fallback](RMT_CURVE_TASK045_OPERATIONS_SAFE.md#if-the-hosted-flow-is-unavailable)

For later separately authorized acceptance, verify the full connected Rabby address and chain after each account switch. For each Safe, compare both owners' EIP-712 requests against the same reviewed Safe address, current nonce, destination, value and decoded call. Confirm the second approval comes from a distinct owner and matches the same Safe transaction hash. Verify receipt and settlement separately after authorized execution. [Safe transaction checks](https://help.safe.global/articles/2485383995-how-to-perform-basic-transactions-checks-on-safewallet)

## What still needs your decision

1. Approve a distinct final salt and select a gas payer for each Safe. Designate the protocol deployment EOA by public address as a separate release input.
2. Approve actual Safe creation separately. Then verify both independent proxies, their singleton and handler, owners and threshold, empty module lists, zero guards, and receipt and claim paths. Enter only the verified on-chain Safe addresses as immutable beneficiaries.
3. Approve the final economics and confirm who handles signer continuity and incidents.

Release status is **BLOCKED_NO_BROADCAST**. Candidate `d4d81d1153a11728d98e694c1f3976ceb3408915` retains the **22 high Slither findings** (18 active-engine and four dependency). Production archive and trace capacity, Ethereum L1 finality, hosted routing, durable indexing and physical-wallet acceptance remain open. Protocol deployment, funded acceptance and public activation each require their own authorization. [Exact release manifest](evidence/rmt-task041-closeout/release-manifest.json) · [Release closeout](RMT_CURVE_TASK041_RELEASE_CLOSEOUT.md)
