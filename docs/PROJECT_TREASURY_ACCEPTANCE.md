# Optional project treasury acceptance

Development candidate for [Task 076](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/669#issuecomment-6989794878), stacked on Task 075 at `51e0ee874b635f1e104a40ff6419af3b5659fb90`. **BLOCKED_NO_BROADCAST.** This module is not deployed, production-enabled or independently audited. No production service, database, Firebase record, governance notice or royalty setting is changed.

## Product decisions

| Project and selection | Creation and earnings behavior |
| --- | --- |
| Standalone token, no treasury | Normal unchanged factory creation; zero treasury address and allocation. |
| Existing NFT community, no treasury | Same token creation. Collection metadata stays local; no collection calls or royalty changes. |
| Either, existing wallet beneficiary | Existing EOA/Safe beneficiary path and original fee ledgers remain available. |
| Either, optional contract treasury | Separate deterministic treasury deployment, then normal creator token creation with the exact verified beneficiary and intent. |
| Contract treasury with zero project share | Optional funding sidecar; core beneficiary and share stay zero. It gains no fee entitlement. |
| Before graduation | Treasury claims only its immutable original curve-ledger credit, including after V1→V2→V3 migration. |
| After graduation | Collection credits the original locked position's fee ledger; treasury claims its own native/token credits. Principal remains with the original engine. |

The existing factory does not deploy treasuries. A wrapper calling it would replace the creator's `msg.sender`; this implementation instead uses a recoverable two-step journey. Treasury deployment may precede token launch. Cancellation leaves that deployed treasury and its own funds intact; it cannot reserve another creator's intent or alter an existing beneficiary. A failed second transaction can be recovered/reviewed without redeploying the treasury. The creator pays additional synthetic deployment gas in the isolated fixture; no new platform creation fee is introduced.

The project chooses 0–100% of its **90% project share**. The existing denominator is preserved: 2,250/10,000 of eligible fees means 25% of the project's share. The core still fixes one billion tokens/18 decimals, 600M curve/400M liquidity, 0.0004 ETH creation fee, 2 ETH graduation backing, 1% curve fee, 90/5/5 eligible-fee distribution and 0.30% original pool fee. Treasury ownership cannot change these commitments, creator identity or holder balances.

## Implementation and trust

`packages/contracts/project-treasury` is an independent factory/treasury/interface package. Every existing tracked Solidity file and the core compiler configuration remain byte-for-byte unchanged. The full new closure has three source files and no external Solidity imports. `scripts/treasury/compiler.mjs` verifies the pinned 0.8.26 executable, compiler settings and complete source closure. Factory runtime/initcode are 1,881/26,100 bytes; treasury runtime/initcode are 22,705/23,377 bytes. Fixed constructor arguments remain within EIP-3860 and both runtimes within EIP-170. Core bootstrap size and identity are unaffected.

CREATE2 binds chain, factory, creator, persistent intent, controller, share, fixed creation template and pinned core dependencies. The factory accepts creation bytes only with its immutable compiled-template hash; the server supplies those bytes. One-use controller initialization is completed atomically by that factory. Exact materialization of all five treasury immutables is required before admission. No arbitrary code, delegatecall, spender approval, platform administrator or general upgrade entry point is available.

Supported controllers are an EOA, the pinned MetaMask delegation, or the pinned SafeL2 1.4.1 profile with three distinct EOA owners and two approvals, no modules/guard, and the reviewed fallback handler. Browser Safe controls produce an unsigned inner CALL; they do not impersonate an owner as the contract beneficiary or submit a Safe transaction. Actual 2-of-3 execution belongs to the isolated operator rehearsal. A Safe acting as the **creator of the treasury deployment** is not admitted by this fixture's direct-creator transaction verifier; Safe control of an EOA-created treasury is a separate supported profile.

The controller may propose replacement, with two days' public notice and incoming-controller acceptance. Rotation disables purchase intent and increments epochs. Queued withdrawals reserve an exact asset/amount/recipient, require the same epoch and two days' notice, and have bounded expiry; failed payment rolls back. Expired/stale reservations can be cleared without redirection. Maximums are eight token assets and sixteen pending withdrawals. Lost EOA control or Safe quorum has no RMT override. Beneficiary entitlements remain at the original treasury; a future contract cannot silently inherit them.

ETH and explicitly admitted, actually registered fixed-supply Token V2 ERC-20 assets are supported. Arbitrary ERC-20s, WETH/USDC, rebasing/taxed tokens and NFTs are not supported. Manual deposits, payer-declared royalties, unsolicited/reconciled transfers, curve receipts, LP receipts, held funds, reservations and withdrawals have separate counters. ERC-20 transfers do not require callbacks; exact balance deltas and runtime checks are mandatory. A funding label does not prove marketplace enforcement. Never send NFTs to this non-receiver.

## Purchase limitation

Purchase permission starts OFF. Its policy stores caps, minimum accumulation, cooldown, period, slippage/impact bounds and revocable epochs. Requests validate deadline, quote age/block, reservations, minimum output and nonzero route/reference commitments. Those fields do **not** establish independent market evidence. V1 has no admitted independent reference or executable route, so `purchaseExecutionAvailable()` is false and `executePurchase` always reverts. There are no purchase transactions, fabricated success events or automatic burns/distributions. Funds remain held and withdrawal/funding controls remain available when permission is disabled.

This is an intentional implementation gap permitted by Task 076's fail-closed boundary. Actual purchase execution requires a separately reviewed version with accepted price/manipulation defenses and canonical route evidence. V1 is immutable: do not deploy it expecting a later switch to enable swaps. Future fee entitlements cannot be moved by merely forwarding settled assets.

## Website and indexing

The existing `/create-token` form offers opt-out, existing beneficiary, or optional contract treasury; it preserves the draft, intent, separate review, rejection, missing-hash recovery and immutable creation fields. `/my-launches/treasury` displays actual accounting, original fee credits, controller/epoch, noticed requests and indexed events. NFT collection information remains local draft metadata; nothing is fetched, uploaded or redirected.

The existing fixture worker remains the only writer. Additional tables are admitted only in the named disposable loopback PostgreSQL fixture. Their records bind chain, both factories, canonical block hash, transaction and log identity; their inserts share the core checkpoint transaction, and reorg rollback cascades through the same checkpoints. Exact receipt logs must agree with provider logs, including topics and transaction membership. Authentication, bounded reads and existing settlement proofs are preserved. Production Railway schemas and writers are untouched.

Local support requires every existing chain-31337 manifest/origin gate plus `RMT_PROJECT_TREASURY_FIXTURE=local-reviewed-project-treasury-v1` and an absolute reviewed module manifest. Hosted flags, malformed manifests, wrong origins and missing bindings fail closed. Public reads report unavailable, financial POSTs return 404, and hosted startup rejects private fixture variables. The public build never asks for wallet access. Native claims or withdrawals without independent transfer evidence remain pending. Recovery never automatically signs or resubmits.

Fixture limits are explicit: treasury birth verification covers at most 4,096 blocks and 128 treasuries; reads return at most 100 events and 16 pending withdrawals. Recovery scans at most 256 blocks. These are local acceptance limits, not production-scale indexing readiness. Production activation requires a separately accepted durable deployment/indexing configuration and canonical finality/trace policy.

## Reproduce

Use Node 22, pnpm 10.12.1, Foundry 1.7.1, checksum-pinned solc 0.8.26, PostgreSQL 18 and the installed pinned core dependencies.

```sh
pnpm install --frozen-lockfile
pnpm --filter indexer build
pnpm --filter @rmt/launch-website build
pnpm --filter @rmt/launch-website test:history
pnpm --filter indexer test:resilience
pnpm --filter indexer exec tsx --test src/curve-fixture-project-treasury-call.test.ts
forge test --root packages/contracts/project-treasury --use /absolute/path/to/solc-0.8.26 -vvv
node scripts/visual-qa/rmt-creator-integration.mjs --treasury-only \
  --browser chromium --anvil /absolute/path/to/anvil \
  --solc /absolute/path/to/solc-0.8.26 --pg-bin /absolute/path/to/postgresql/bin \
  --output /absolute/path/to/new-isolated-evidence
```

Repeat the final command with `--browser webkit` and a distinct output directory. It starts only disposable loopback processes, synthetic signers and a named isolated database; it never connects a production writer. Browser emulation is not physical iPhone acceptance. `.github/workflows/launch-website-review.yml` retains the original lifecycle and Task 075 profiles, then adds this treasury journey for both engines. The security workflow separately analyzes the complete new module without detector exclusions.

## Security and release holds

The existing **22 core/dependency high findings and two failed strict gates remain**. Fresh Slither 0.11.5 runs all 101 detectors on the new complete closure: 25 findings, including **six new highs**, four medium, ten low and five informational. The new strict module gate fails. Original seven-high and current six-high reports are retained separately; explicit byte concatenation removed one encoding observation while exact settlement assertions were retained. The six remaining balance observations have internal safeguards and test evidence, not independent clearance. See [each finding and remaining uncertainty](PROJECT_TREASURY_SECURITY.md). Passing lifecycle tests is not an audit or production authorization.

Separate prerequisites include review/disposition of those findings, independent price/route support before any purchasing version, contract deployment/runtime acceptance, controller/backup responsibilities, supported assets and withdrawal-policy acceptance, production discovery/trace/finality acceptance, and separate website/financial activation approvals. No approval is requested for completed local development.

## Unexecuted integration example

After a receiver is separately deployed and payment-tested, LAMMB Genesis could independently authorize royalties to its own dedicated treasury; that treasury could later buy its launched project token only after accepted liquidity/reference evidence and a reviewed purchasing version exist. Current Genesis royalties remain unchanged. Spending settled RMT creator revenue on LAMMB NFTs is a distinct future strategy requiring its own asset/payee/amount authorization; it is not enabled by a royalty deposit or purchase toggle. RMT Reclaim remains a separate unimplemented, manually funded module ($20 initial target and $0.05 per eligible NFT, later adjustable), not part of this treasury's purchase authority.
