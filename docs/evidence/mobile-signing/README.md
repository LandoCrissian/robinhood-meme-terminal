# Mobile deployment review

See the [current unsigned deployment handoff](UNSIGNED_HANDOFF.md) for the private review packet and owner approvals, and the [Task 055 delegated-wallet handoff](DELEGATED_WALLET.md) for the 4663 delegate qualification. This file records the Task 054 review.

**BLOCKED_NO_BROADCAST.** The 4663 packet orders the two Safe proposals, five contract deployments, both directory notice and execution pairs, and the first NEW RMT creation. It contains hashes, reviewed values and expected addresses. The live transaction list and verified production beneficiaries are empty. The proposed personal sender has no Safe ownership. Both SafeL2 1.4.1 proposals keep the three existing governance owners, 2-of-3 threshold and separate salts. [Review packet](review-plan-4663.json)

At Robinhood block 115909907, three read-only providers agreed on the proposed sender's confirmed and pending nonce of 475, balance of 0.004457035386534138 ETH and EIP-7702 delegation. The current binding requires a code-empty account. The packet cannot derive binding production CREATE addresses from this observation. Both Safe CREATE2 addresses were vacant at the observed block. Estimated execution was 313,391 gas and 0.000006322976816 ETH each, with zero L1 poster fee quoted at that block. The combined sample was 0.000012645953632 ETH. The snapshot records an expiry and is unsuitable as a current fee quote or proof of key control. [Read-only observation](sender-observation-4663.json) · [Delegation format](https://eips.ethereum.org/EIPS/eip-7702)

The isolated site accepts an injected EIP-1193 wallet on the exact loopback origin with the configured synthetic 31337 account. It rechecks the reviewed transaction, factory and canonical block, quote, account and pending nonce before requesting one local confirmation. A journal written before the request preserves the original intent and recorded hash. Recovery reads evidence and checks the original request. The public site denies both review and transaction-preparation routes.

The Pinax-backed local 4663 rehearsal verified the official Uniswap runtime pins at upstream block 114549452 and completed three synthetic projects, including the first RMT. The first RMT's two governance notices, execution calls and creation bind to the observed synthetic sender, nonce, input hash and receipt. The Pocket pass reproduced the lifecycle, and later Pocket attempts encountered a missing receipt and then an archive failure. [Fork lifecycle](fork-rehearsal-4663.json) · [Action and creation bindings](fork-action-bindings-4663.json)

For later physical acceptance, open the verified review origin inside the selected wallet's in-app browser, select the intended network, and tap **Connect** only. The current synthetic origin is desktop loopback. Physical iPhone access and injected-provider support on that device remain unverified. No QR relay or paid connector is configured. [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) · [MetaMask Connect documentation](https://docs.metamask.io/metamask-connect/)

## Reproduce

Use the pinned compiler, Anvil and local PostgreSQL from the [deployment runbook](../../DEPLOYMENT.md). Supply fresh output paths and keep the loopback gateway private.

```powershell
node packages/contracts/scripts/mobile-review-plan.mjs --solc $solc --fixture-lifecycle --verify docs/evidence/mobile-signing/review-plan-4663.json
node scripts/production-readiness/mobile-sender.mjs --output $freshReadOnlyObservation
pnpm test:fork-4663 --anvil $anvil --solc $solc --archive pinax --output $forkEvidenceFile
node packages/contracts/scripts/mobile-review-plan.mjs --solc $solc --rehearsal $forkEvidenceFile --output $freshReviewPacket
node scripts/visual-qa/rmt-creator-integration.mjs --anvil $anvil --solc $solc --pg-bin $postgresBin --mobile-plan docs/evidence/mobile-signing/review-plan-4663.json --output $browserEvidenceDirectory
```

## Release gates

- The exact 4663 compiler closure retains 22 high findings and seven governance-medium dispositions. [Security](../../SECURITY.md)
- Reverify sender eligibility, nonce, code pins, address vacancy and fees immediately before any separately approved signing. Bind verified Safe recipients, approved economics and first-project inputs.
- Qualify physical wallet acceptance and recovery. Verify production archive receipts and traces, L1 finality, durable new-engine indexing and hosted full-PoolKey routing for the eventual deployment.
- Obtain separate approvals for deployment, first funded acceptance and public activation.
