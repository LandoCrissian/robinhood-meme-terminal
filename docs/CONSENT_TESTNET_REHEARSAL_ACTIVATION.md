# Consent rehearsal activation — Robinhood Chain testnet

This runbook covers the only supported activation of the verified, paused consent-migration rehearsal. It is a valueless testnet procedure, not a production release, public migration flow, official Sushi deployment, Robinhood product, bridge, recovery service, or authorization to use real assets.

The activation console is local-only. Next.js returns `404` whenever `NODE_ENV=production`, `VERCEL=1`, either operator flag is not exactly `true`, or the request host is not loopback. Never set either flag in Vercel or another hosted environment, and never bind this development server to a LAN or public interface.

## Pinned release

- Network: Robinhood Chain Testnet, chain ID `46630`
- Operator and guardian: `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA`
- Governance: `0xA7892f1D730132834493C5DC361e289430D3d3c0`
- Migrator: `0x01Cdc5FA002F0dEee4B153D31763392EC81e8f05`
- Consent stack: `0x662F4dC5fE4115BE317BeFc0D77f4C1d6adeE576`
- Configuration hash: `0x1e626fe6109321b4363aef67f3a66ff3af92abeda98441d6809df19b702b4a09`
- Terms document hash: `0x236ed1f849548c61a923152a92dc91593f22a6e2ff3d176a4b0db38b3b2d2b57`
- Migration terms hash: `0xeb32892f8c20fbd279e13e05ea9a7a63667196a77198b43b5001a7a94647e93f`
- Source commit: `b21a28276a4ff62253c36988167d613eb44fbb3c`
- Contract-source SHA-256: `0781f4f534d33b0ecdb773a8ccc4da3f283772432203f11c5af8394d53eb0f1e`

The canonical record is `packages/contracts/deployments/robinhood-testnet-consent-rehearsal-2026-07-18.json`. The console refuses to act if live code, topology, governance, signer, timing, terms, or configuration differs from that record.

## Open the local console

1. Start from a clean, reviewed checkout whose deployed contract sources reproduce the pinned source commit and contract-source SHA-256 above. The local activation-console code may come from a newer reviewed web release; it must not alter the pinned contract identity.
2. In `apps/web/.env.local`, set both `RMT_OPERATOR_CONSOLES_ENABLED=true` and `RMT_CONSENT_TESTNET_ACTIVATION_ENABLED=true`. Do not place either value in a hosted environment.
3. Start the web app with its hostname explicitly bound to `127.0.0.1`, never `0.0.0.0`, then open `http://127.0.0.1:3000/activate-consent-testnet`.
4. Connect only the fixed operator wallet on chain `46630`. The app never asks for or handles a private key or recovery phrase.
5. Let the console reproduce all release checks. A mismatch is a stop condition; do not bypass it.

The authorization snapshot must also prove the untouched rehearsal state at one exact block: zero position-manager supply; no active session migration or owner; the operator still owns each token's complete fixed supply; zero paired-token and WETH balances at the pool, session, migrator, and position manager; and zero session-to-manager allowances for both tokens. An accidental direct transfer or allowance is a stop condition even when every runtime hash still matches.

## Proposal

Read the immutable testnet terms in the console and type the displayed acceptance sentence exactly. The proposal is fixed and has no editable fields:

- `target`: the pinned migrator
- `value`: `0`
- `data`: `0x3f4ba83a`, the `unpause()` selector

The console simulates this exact governance proposal before requesting wallet approval. After two confirmations it verifies the mined transaction sender, destination, value and input; the exact `Proposed` event; and the stored governance transaction. Download the activation evidence JSON and retain it with the release record.

Reloading the page does not require making a second proposal. The console searches from the pinned deployment block and recovers only the unique proposal whose proposer, target, value, calldata, governance epoch, confirmation state, and execution window match the reviewed action. Any additional or conflicting governance transaction blocks the release.

The browser stores the typed-acceptance timestamp locally. If that local evidence is missing, recovery must never invent an earlier acceptance time from the proposal block. While the exact proposal is still waiting or executable, the console shows the recovered onchain proposal, blocks execution, and requires the operator to read the terms and explicitly record a new reviewed recovery acceptance with its real current timestamp. Recovery acceptance is permanently unavailable after execution, cancellation, or expiry and is a local review record—not a wallet signature or retroactive attestation.

If any binding drifts while a proposal is pending, cancel it. The cancellation control intentionally depends only on a single-block snapshot of the pinned governance runtime, signer configuration, timing policy, transaction count, and exact proposal. It simulates and submits only `cancel(proposalId)` with zero value, then verifies the mined transaction, exact `Cancelled` event, and `cancelled == true` onchain. This reduced dependency set keeps the incident control available when a non-governance contract check is the reason activation stopped.

## Mandatory delay and execution

The proposal cannot execute for at least 24 hours. Its execution window then remains open for seven days. The console uses the latest block timestamp, not the computer clock, and disables execution before `executeAfter` or after `executeBefore`.

Immediately before execution, reproduce every release, runtime, signer, governance, terms and proposal check. The console simulates `execute(proposalId)` before wallet approval, then verifies the mined zero-value governance transaction, exact `Executed` event, consumed onchain proposal, and `migrator.paused() == false`.

Governance execution is permissionless after the signer has fixed and approved the payload. The console itself still offers execution only to the fixed operator. Recovery accepts any nonzero mined executor only when the governance destination, zero value, exact `execute(proposalId)` input, proposal ID, epoch, execution event, unpause event, and final state all match. This prevents an unrelated third-party call from being mistaken for the reviewed execution while allowing the guardian to react if another account executes the already-approved proposal.

Activation only changes the migrator pause bit. It does not transfer tokens, perform a migration, expose a public execution interface, create a bridge, or establish production readiness. Keep the public migration interface disabled.

## Emergency pause

The fixed guardian may call only `pause()` directly on the pinned migrator. The console simulates the exact zero-value call, then verifies transaction sender, destination, value, input, successful receipt, exact `PauseChanged(true, guardian)` event, and `paused() == true`. Treat any mismatch as an incident and retain the evidence record.

Emergency pause remains available whenever an independent live read shows the pinned migrator is unpaused and the fixed guardian wallet is connected, even if proposal, topology, or evidence recovery is degraded. Immediately before simulation and signing, the pause action uses a minimal single-block safety snapshot: chain `46630`, the pinned migrator address and runtime hash, the fixed guardian, the pinned governance binding, the migrator destination chain, and `paused == false`. Unrelated drift cannot disable the stop control.

## Stop conditions

Stop without signing if the wallet, chain, any address, any runtime hash, source identity, topology, configuration hash, terms hash, signer configuration, governance timing, proposal fields, transaction count, transaction input, receipt, or emitted event differs from the console and this runbook. Do not substitute a different RPC result, target, calldata, proposal ID, signer, contract, or terms document.

This procedure is not an audit. Independent security and legal review remain required before any real-value or public execution release.
