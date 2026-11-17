# Unsigned Robinhood Chain deployment handoff

**`BLOCKED_NO_BROADCAST`** · chain 4663 · frozen fixed-supply engine

MetaMask on the owner's iPhone returned the proposed account `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA` and verified its pinned delegation at block `116037169`. The new read-only probes check that delegation again. Type-2 Safe calls and top-level CREATE transactions were exercised with synthetic funds on the pinned fork. Physical-device transaction signing remains unverified. [Connection evidence](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/644)

## Approved configuration

The owner approved both SafeL2 1.4.1 configurations, the pinned salts, the existing 2-of-3 governance owners and the personal MetaMask payer. Both treasury addresses remain predicted until canonical creation receipts and runtime checks. [Owner approval on issue #645](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/645#issuecomment-6930920399)

The first new token is `RMT` (`RMT`). The creator is the same existing personal MetaMask address and receives the full project share. The project URI is the empty string. The separate project treasury allocation is zero and encodes the zero address and zero basis points of eligible fees. Launch economics are 1 billion units with 18 decimals, 600 million curve inventory, 400 million for the original permanently locked v4 position, 0.0004 ETH creation, 2 ETH graduation backing, a 1% curve trading fee, a 0.30% v4 pool fee, and a 90% project, 5% Operations, 5% Reserve split of eligible earned fees. Post-graduation LP revenue is earned by the original position.

The phone reviews only transaction 1, the zero-value Operations Safe creation. Each Safe creation, protocol deployment, first funded acceptance and public activation requires its own approval. Reserve and the protocol queue wait for verified canonical receipts and the applicable release gates. [Safe preparations](../rmt-task046/treasury-safe-initializers.json)

## Refresh Operations Safe transaction 1

The owner completed the physical iPhone read-only review. The refresh prepares the same 4663 call for review and independently checks the confirmed and pending nonce, delegation, Safe infrastructure, owner set, calldata and vacant predicted address. A mismatch with the reviewed transaction stops the refresh. [Read-only review evidence](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/649)

The conditional owner approval covers Operations Safe transaction 1 and fixes its ceiling at **0.00001567739478 ETH**, with gas limit **391,739**, max fee **40,020,000 wei/gas** and priority fee **zero**. The refresh compares current evidence with these exact limits and leaves them fixed. If the buffered recommendation exceeds the approved limits, the page shows the observed estimate and the separately calculated ceiling for review. The preparation stays stopped and requires fee approval before reconsideration. [Owner fee-ceiling approval](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/649#issuecomment-6936656732) · [Task 060](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/651)

```powershell
pnpm prepare:operations-safe --out-private $privatePacket --out-review $reviewPacket --review-only-over-cap
pnpm export:private-phone-review --url $approvedPrivateHttpsUrl --review $reviewPacket --output $privateHtml --key-file $separateKeyFile --expires $expiryUtc
```

The review-only flag allows a blocked diagnostic sheet when the current recommendation exceeds the ceiling. In that case the packet contains no unsigned transaction envelope. Running without the flag stops without exporting the over-cap sheet.

The proposed gas limit adds 25% headroom to the larger of `eth_estimateGas` and the Nitro total and rounds up. The Nitro total includes L1 posting in L2 gas units. The proposed maximum fee per gas is twice the observed L2 base fee, with zero priority fee. The network fee ceiling is the product of the proposed gas limit and maximum fee per gas. A larger gas requirement or fee change requires a fresh review. A zero quoted L1 component is a block-specific observation. [Arbitrum fee estimation](https://docs.arbitrum.io/arbitrum-essentials/how-to-estimate-gas) · [EIP-1559](https://eips.ethereum.org/EIPS/eip-1559)

Open the exact HTTPS review URL and enter its separate access code. The page displays the signing decision and distinguishes an expired quote from a current estimate. Signing approval remains unavailable while the exact release gate fails, even when the transaction fits the approved fee ceiling. Use the existing finding matrix for independent disposition of the exact findings, correct confirmed defects and rerun the strict checks on the reviewed candidate. Revalidate this call and seek separate transaction approval only after release clearance. [Security findings and review inputs](../../SECURITY.md)

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

Stop on sender, chain, delegate, nonce, block, calldata, destination or runtime mismatch. If a wallet returns no hash or the receipt is missing, keep the original request pending and recover its exact sender, nonce, transaction and receipt before preparing a later step. A revert consumes a nonce when mined. Recompute affected addresses and constructor data from a fresh observation. The Directory actions still require two current signatures, verified receipts and mature notices. First RMT creation still needs a fresh intent, nonce, deadline and verified deployment bindings.

## Private preparation and phone review

Use the pinned tool paths from the [deployment runbook](../../DEPLOYMENT.md). Use fresh output paths in an owner-controlled directory outside the Git checkout. The packet keeps the Operations call and the privately queued Reserve and constructor preparations. Its encrypted phone projection contains one transaction's review fields and hashes. Keep the unsigned packet and decryption key in private storage.

```powershell
pnpm test:fork-4663 --anvil $anvil --solc $solc --archive pocket --delegated --approved-rmt --output $forkEvidenceFile
pnpm prepare:unsigned-4663 --solc $solc --rehearsal $forkEvidenceFile --refresh --out-private $privatePacket --out-review $reviewPacket
pnpm export:private-phone-review --url $approvedPrivateHttpsUrl --review $reviewPacket --output $privateHtml --key-file $separateKeyFile --expires $expiryUtc
```

Use the Operations-only refresh for the current phone review and proposed fee cap. Figures for later dependent transactions are fork observations until their exact live prerequisites exist.

## Release evidence

- Foundry 1.7.1 with solc 0.8.26 passed 95 tests, with zero failures or skips. The accounting invariant ran 64 sequences and 2,048 calls.
- The Pocket-backed loopback Anvil fork used Robinhood block `114549452` and hash `0xf9a8ca5d8e26ebb426ebd2e663ad82afc878c16d8bba5f5542f6341890cf7710`. The full delegated rehearsal reached `LIFECYCLE_REHEARSED` for three projects with treasury shares of 2,250, 4,500 and 0 basis points of eligible fees. The run covered both Safe calls, five type-2 CREATEs, four Directory transactions, two same-token migrations per project, v4 trades, fee claims and unchanged LP principal. Each Safe consumed 306,195 gas on the fork. The five CREATEs consumed 22,604,164 gas combined. RMT fixture creation and graduation consumed 3,348,696 and 1,546,513 gas. These are historical synthetic costs in gas units. The Safe calls have separately priced current read-only estimates in the private review.
- Synthetic RMT creation receipt `0x994e061289f908cc7b9705691676cd0b851cdd79320b7a2594687386a1b47814` and graduation receipt `0xa9ed8e677db3af8fde3fb3f3be0323261d27f94a58f9c561d5f968936ac2c79f` appear in the local rehearsal report with SHA-256 `c3674292fc584bc029fcd3e02184899f62dbfc4bc77a1a7aa588470cc5555c71`.
- The same-app 31337 browser/PostgreSQL run passed creation, curve trades, v4 graduation and swaps, fee collection, claims, interrupted receipt reads, lost-hash recovery, restart and reorg rollback. The public-build execution block passed. Chromium and WebKit exercised the private review in portrait and landscape with injected test wallet reads. The private layout check does not establish physical-device transaction signing.
- The existing 4663 source and compiler inputs remain frozen. The exact security closure retains 22 high findings and seven governance-medium observations. The release gate remains failed. [Security findings and dispositions](../../SECURITY.md)
- Blockscout preparation exported the exact offline compiler input and 14 fixture bindings. Standard JSON SHA-256 `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`. The measured bootstrap initcode had 423 bytes of headroom. Verification of any deployed contracts requires canonical receipts and matching materialized runtime. Source verification establishes source correspondence.
- Production archive/trace availability, L1 finality, durable indexing and exact-PoolKey hosted routing require verification against the eventual authorized deployment. The website remains read-only.
