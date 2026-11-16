# Delegated wallet handoff

**BLOCKED_NO_BROADCAST.** This review qualifies the proposed sender's exact existing MetaMask EIP-7702 designator and Robinhood runtime for direct type-2 rehearsal. The personal sender is separate from the three governance owners and both treasury roles. Both SafeL2 1.4.1 proposals retain separate salts and the same 2-of-3 governance owners. Protocol and first-project production inputs remain unassigned. [Address and RPC evidence](sender-delegation-4663.json)

Robinhood code at the delegation target hashes to `0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0`. The account points to MetaMask's Stateless DeleGator v1.3.0. The bounded probe observed an actual nonce change from 475 to 476, discarded the conflicting observations, and independently reread the code, chain anchor and confirmed and pending nonce. At block 115939588 the refreshed reads agreed on nonce 476. Both proposed Safe addresses and the five counterfactual CREATE slots were vacant then. The two Safe read simulations estimated 313,391 gas each, or 0.000012659742836 ETH total at the sampled fee and zero quoted L1 poster component. Refresh nonce, vacancy and fees before any separately approved action. [Runtime comparison and historical type-2 CALL](delegate-provenance-4663.json) · [EIP-7702 transaction origination](https://eips.ethereum.org/EIPS/eip-7702#transaction-origination) · [MetaMask versioned deployment source](https://github.com/MetaMask/delegation-framework/releases/tag/v1.3.0)

## Direct signing path

The review prepares one ordinary EIP-1559 transaction at a time. An existing valid delegation indicator permits direct origination. Safe calls have the exact factory destination and initializer. A top-level CREATE omits the destination and carries verified constructor input. The review rejects delegation authorizations, alternate delegate code, batching, user-operation relays, unexpected fee caps, changed nonce and substituted recipients. Receipt verification checks the mined transaction and expected result. A reverted transaction consumes its sender nonce, so recalculate downstream CREATE predictions before considering any new transaction. A Safe's CREATE2 address remains tied to its factory, initializer and salt.

The 31337 web fixture launches an isolated Prague chain and uses a disposable synthetic delegate that always reverts if called. The wallet adapter checks pinned code at the review block and pending state, then requests a direct type-2 transaction only after explicit acknowledgement. Its original-intent journal supports recovery without rebroadcast and can still verify prior legacy fixture journals. The browser proof and 4663 fork proof are separate from the live iPhone connection check.

On the pinned Pocket-backed 4663 fork, the exact delegated account was impersonated at nonce 473 with its existing designator unchanged. Both Safe calls and all five top-level CREATEs produced matching type-2 receipts. Both Safes consumed 306,195 gas each, and the five constructors used 22,604,164 gas combined on that synthetic fork. A separate disposable key demonstrated real type-2 signatures for contract creation and a mined revert. The post-deployment governance and three-project lifecycle replay substitutes disposable governance signers and preserves the real two-day notices in fork time. The owner's key control remains unverified. [Synthetic receipts and lifecycle](delegated-fork-4663.json)

The 12-stage review binds the fork receipts separately from the archived nonce-476 scenario. The constructors, notices and first creation used 26,346,932 gas on the fork. Multiplying by the archived L2 base fee gives an illustrative 0.000532155332536 ETH for those operations before L1 posting, priority fees and the creation payment. A live protocol quote still requires exact verified inputs. [Unsigned review packet](review-plan-delegated-4663.json)

## iPhone connection only

Generate the single HTML file for an already-approved, phone-reachable HTTPS URL. Serve only this connection check there. The file locks to the exact URL and uses no backend, RPC bridge, transaction payload, credentials or external script. It calls only the wallet's account permission and account/network reads.

```powershell
node scripts/visual-qa/export-mobile-connection-check.mjs --url $approvedExactHttpsUrl --output $newLocalHtmlFile
node scripts/visual-qa/rmt-mobile-connection-check.mjs
```

Once the exact URL is available, open it in **MetaMask Mobile → Explore → browser**, select the proposed account on **Robinhood Chain 4663**, and tap **Check connection**. The expected message is **Connection verified locally for the proposed account on Robinhood Chain 4663.** This step needs no signature or transaction confirmation. An actual iPhone and compatible HTTPS origin are still required for live connection evidence. Physical CREATE signing compatibility remains a separate qualification. [MetaMask mobile browser instructions](https://support.metamask.io/configure/wallet/how-to-use-the-metamask-mobile-browser) · [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193)

## Reproduce the fork and offline plan

Use the pinned tools and fresh output paths from the [deployment runbook](../../DEPLOYMENT.md). All fork writes target loopback.

```powershell
pnpm test:fork-4663 --delegated --anvil $anvil --solc $solc --archive pocket --output $forkEvidenceFile
node packages/contracts/scripts/mobile-review-plan.mjs --solc $solc --rehearsal $forkEvidenceFile --delegated-observation docs/evidence/mobile-signing/sender-delegation-4663.json --reconstruct-recorded-observation --output $newReviewFile
node scripts/visual-qa/rmt-creator-integration.mjs --anvil $anvil --solc $solc --pg-bin $postgresBin --mobile-plan docs/evidence/mobile-signing/review-plan-4663.json --output $browserEvidenceDirectory
```

Archived reconstruction serves reproducible review. A fresh observation is required for live preparation, and both operation approvals and the production transaction list remain empty. The 22 high and seven governance-medium findings, wallet/device acceptance, verified Safe beneficiaries and production infrastructure gates retain their existing release status. [Security](../../SECURITY.md)
