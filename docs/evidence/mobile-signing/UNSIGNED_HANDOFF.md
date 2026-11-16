# Unsigned Robinhood Chain deployment handoff

**`BLOCKED_NO_BROADCAST`** · chain 4663 · frozen fixed-supply engine

MetaMask on the owner's iPhone returned the proposed account `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA` and verified its pinned delegation at block `116037169`. The new read-only probes check that delegation again. Type-2 Safe calls and top-level CREATE transactions were exercised with synthetic funds on the pinned fork. Physical-device transaction signing remains unverified. [Connection evidence](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/644)

## Owner approvals

1. **Treasuries.** Confirm the existing personal MetaMask account as the gas payer for the two Safe creations. Review both zero-value calls and a fresh combined gas estimate. Both SafeL2 1.4.1 instances use the existing three governance owners and require two approvals. Their addresses become protocol input candidates after canonical creation receipts and runtime checks.
2. **First project.** Approve the proposed `RMT` name and `RMT` symbol or supply the final values. Supply the exact project URI or explicitly approve an empty URI, the existing creator address that will submit creation, and the percentage of the project share going to a separate treasury. Supply the existing treasury address if that percentage is above zero. The contract takes basis points of eligible fees, so 25% of the project share is encoded as 2,250 of 10,000. Its maximum is 9,000. The treasury must differ from the creator. At 0%, the contract uses the zero address for the treasury.
3. **Protocol terms.** Approve the proposed 0.0004 ETH creation fee, 2 ETH graduation backing, 1% bonding-curve trade fee and 90% project, 5% Operations, 5% Reserve split. The candidate mints 1 billion units at 18 decimals, sells 600 million along the curve and reserves 400 million for the original permanently locked v4 position. The v4 pool fee is 0.30%. Post-graduation revenue is earned by that position.

Treasury creation, protocol deployment, first funded acceptance and public activation each require a separate release decision. The two Safe roles and their proposed addresses and salts are recorded in the existing treasury evidence. [Safe preparations](../rmt-task046/treasury-safe-initializers.json)

| Safe | Predicted 4663 address | Pinned `saltNonce` |
| --- | --- | --- |
| Operations | `0xAF9F10258b091719618c19D057F9cDAB72eFFd8b` | `0x8094029c8a767b073fdbe606186b138b416682f2584ca87d38b3eaaa7af16cc2` |
| Reserve | `0x8D44078642ce938Fd799b23087BcdD6114A302e5` | `0xe0e8b0060b79275b10d83a2573dfc2e48e749a76e0a2efea0ffe422a30b89a87` |

## Transaction order and recovery

| Phase | Ordered transactions | Checks before advancing |
| --- | --- | --- |
| Treasury preparation | Operations Safe, Reserve Safe | Use the pinned `createProxyWithNonce` factory and exact initializers. Recheck both CREATE2 addresses are vacant. After each canonical receipt, verify the proxy address, runtime, implementation, owners and threshold. |
| Protocol | Directory, registry, V2 successor deployer, V3 successor deployer, bootstrap | Verify both Safe receipts, approved economics, live sender and delegation, pending and confirmed nonce, vacant destinations, sizes and six external Uniswap v4 runtime pins. Check the five deployed runtimes and the bootstrap children, including the hook permission bits and factory bindings. |
| Governance | Schedule factory publication, execute it, schedule V3 successor admission, execute it | Bind both current signers to the exact Directory domain, chain, epoch, nonce, action and deadline. Each action has a two-day notice and up to seven days to execute, subject to its signed deadline. The Directory allows one pending action, so the two notices take at least four days in sequence. Verify each scheduled action, delay, canonical receipt and resulting state. |
| First launch | Create new RMT from the approved creator | Bind the immutable metadata, treasury allocation, fresh intent and deadline. Review the exact fee value. Verify the token, curve, supply, starting backing and inventory, registry event and fee settlement from the canonical receipt. |

Stop on sender, chain, delegate, nonce, block, calldata, destination or runtime mismatch. If a wallet returns no hash or the receipt is missing, keep the original request pending and recover its exact sender, nonce, transaction and receipt before preparing a later step. A revert consumes a nonce when mined. Recompute affected addresses and constructor data from a fresh observation. Two signatures, actual Directory receipts and approved creator inputs are needed to complete the later unsigned envelopes.

## Private preparation and phone review

Use the pinned tool paths from the [deployment runbook](../../DEPLOYMENT.md). Use fresh output paths in an owner-controlled directory outside the Git checkout. The packet contains exact private calldata for the two Safe calls and five conditional constructors. Its phone projection contains only review fields and hashes. Keep both the packet and decryption key in private storage.

```powershell
pnpm test:fork-4663 --anvil $anvil --solc $solc --archive pocket --delegated --output $forkEvidenceFile
pnpm prepare:unsigned-4663 --solc $solc --rehearsal $forkEvidenceFile --refresh --out-private $privatePacket --out-review $reviewPacket
pnpm export:private-phone-review --url $approvedPrivateHttpsUrl --review $reviewPacket --output $privateHtml --key-file $separateKeyFile --expires $expiryUtc
```

The public site has no new review or execution route. For phone review, open the separately provided private review origin in MetaMask's browser and unlock the encrypted projection. The review binds the selected account, chain, delegation, nonce and reference block without requesting a signature. If the evidence has expired or the nonce has changed, refresh the packet before reviewing a transaction for approval. Figures for later dependent transactions are fork observations until exact live prerequisites exist. Ethereum L1 data fees and protocol execution costs remain subject to fresh estimates at the applicable phase.

## Release evidence

- Foundry 1.7.1 with solc 0.8.26 passed 95 tests, with zero failures or skips. The accounting invariant ran 64 sequences and 2,048 calls.
- The Pocket-backed loopback Anvil fork used Robinhood block `114549452` and hash `0xf9a8ca5d8e26ebb426ebd2e663ad82afc878c16d8bba5f5542f6341890cf7710`. The full delegated rehearsal reached `LIFECYCLE_REHEARSED` for three projects with treasury shares of 2,250, 4,500 and 0 basis points of eligible fees. The run covered both Safe calls, five type-2 CREATEs, four Directory transactions, two same-token migrations per project, v4 trades, fee claims and unchanged LP principal. Each Safe consumed 306,195 gas on the fork. The five CREATEs consumed 22,604,164 gas combined. RMT fixture creation and graduation consumed 3,348,696 and 1,546,513 gas. These are historical synthetic costs in gas units. The Safe calls have separately priced current read-only estimates in the private review.
- Synthetic RMT creation receipt `0x994e061289f908cc7b9705691676cd0b851cdd79320b7a2594687386a1b47814` and graduation receipt `0xa9ed8e677db3af8fde3fb3f3be0323261d27f94a58f9c561d5f968936ac2c79f` appear in the local rehearsal report with SHA-256 `c3674292fc584bc029fcd3e02184899f62dbfc4bc77a1a7aa588470cc5555c71`.
- The same-app 31337 browser/PostgreSQL run passed creation, curve trades, v4 graduation and swaps, fee collection, claims, interrupted receipt reads, lost-hash recovery, restart and reorg rollback. The public-build execution block passed. Chromium and WebKit exercised the private review in portrait and landscape with injected test wallet reads. The private layout check does not establish physical-device transaction signing.
- The existing 4663 source and compiler inputs remain frozen. The exact security closure retains 22 high findings and seven governance-medium observations. The release gate remains failed. [Security findings and dispositions](../../SECURITY.md)
- Blockscout preparation exported the exact offline compiler input and 14 fixture bindings. Standard JSON SHA-256 `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`. The measured bootstrap initcode had 423 bytes of headroom. Verification of any deployed contracts requires canonical receipts and matching materialized runtime. Source verification establishes source correspondence.
- Production archive/trace availability, L1 finality, durable indexing and exact-PoolKey hosted routing require verification against the eventual authorized deployment. The website remains read-only.
