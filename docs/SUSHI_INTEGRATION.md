# Sushi integration

RMT integrates Sushi in stages so a new venue cannot weaken the verified V6 execution path.

## Current stage: verified in-terminal execution

- `apps/web/lib/server/sushi-trade.ts` calls Sushi's official v7 Swap API for Robinhood Chain (`4663`) for validated route construction, then independently simulates the complete deadline-guard transaction through the Robinhood Chain RPC.
- The same-origin `/api/trade/sushi-quote` route accepts only an origin-verified active V6 launch ID and matching token address.
- The same-origin `/api/trade/external-sushi-quote` route supports external Sushi markets in Terminal only after RMT independently re-verifies the exact token, pair, Sushi venue, Robinhood Chain identity, DEX Screener URL, and minimum live liquidity.
- Terminal displays Sushi's token metadata, estimated output, exact 1% minimum output, and price impact. The response must match the requested token, pair, wallet, side, amount, chain, router, executor, bytecode hashes, and supported function or the client rejects it.
- RMT decodes RedSnwapper calldata, pins the current official router and executor runtime bytecode, requires Sushi's validated route construction, rejects price impact above 10%, then wraps the reviewed executor data in `RMTSushiDeadlineGuard.execute` with an onchain 90-second deadline and a replay-resistant order ID. RMT independently simulates that complete guard call from the authenticated trade wallet before returning it.
- Token sells request only the exact allowance needed for the entered trade, and that allowance targets the verified deadline guard rather than RedSnwapper. The guard pulls only the caller's stated input, approves RedSnwapper for that exact amount, clears its approval, and requires that it retain no input. RMT never asks for an unlimited Sushi approval and never becomes a custodian.
- Before an external buy is enabled, RMT also rechecks Blockscout contract transparency and holder concentration, excludes the verified pool and burn addresses from the whale calculation, and reads the reported creator balance directly from the token contract. Missing evidence is shown as unknown rather than passing.
- RMT also simulates a small holder-to-pool token transfer with `eth_call`. A deterministic revert, `false`, or router-incompatible response blocks the buy. The probe changes no state and is disclosed as point-in-time evidence, never a guarantee that a later sale will succeed.
- Published token ABIs are scanned for common supply, transfer, fee, upgrade, access, and launch controls. Active launch-block restrictions are read onchain when exposed. Pool-held supply is never presented as proof that a V3 position is locked.
- For Pons or Noxa projects whose pinned factory publishes a V3 position ID, RMT reads the exact NFT from its published position manager, matches the position tokens and fee back through that manager's factory to the displayed pool, then discloses the current NFT owner and transfer approval state. Creator-held, third-party-wallet, contract-held, and burn-address states are reported separately. Contract custody is never described as a lock without a separate withdrawal-path review.
- Lemon's current public feed does not publish a position ID. Lemon markets therefore remain `not proven locked`; RMT does not infer LP custody from pool balances or metadata.
- `NoWay`, partial fills, changed input amounts, invalid output amounts, excessive/invalid price impact values, upstream failures, and timeouts fail closed.
- V6 launch previews remain off unless both `NEXT_PUBLIC_RMT_SUSHI_QUOTES_ENABLED=true` and `RMT_SUSHI_QUOTES_ENABLED=true` are intentionally deployed. External Terminal quotes require the server-only `RMT_SUSHI_QUOTES_ENABLED=true` flag.

The current production Uniswap v4 graduation and execution path remains unchanged.

The canonical V6 Uniswap path remains available independently. Sushi execution applies to external Sushi markets and does not split or migrate RMT launch liquidity.

### Verified Robinhood Chain boundary

Read-only verification was refreshed on 2026-07-27 against Sushi's official SDK at commit
`f3be96d13f5cca54589b0509c46bb8bdb2583f03` and live Robinhood Chain bytecode:

| Contract | Address | Runtime bytecode hash |
| --- | --- | --- |
| Sushi RedSnwapper | `0x8E6fD69A77e88ee20Ba4B4fBd59DfCDA3EC0E98A` | `0x4b299d0674c86f701924420b3c90e4eb8efcc49f7865cc9680ee631ec7048b97` |
| Current route executor | `0x0e867974275Cd31C25015C2753C9d75F9f355379` | `0x57d45a1dce631a859bd1780826e0fbb9a7489650453406e0dc593724eca6cb6b` |
| Sushi V3 factory | `0xE51960f1B45f1C9FB6D166E6a884F866fC70433B` | `0x1d515a200d61f60a4075b5895f5f282b05e0772ca0749f9fa1589e981165d5f0` |
| Sushi V3 position manager | `0x51d0e5188afe12d502e29d982d20c190e7816107` | live code required before position evidence is accepted |
| Sushi V3 quoter | `0x3E290E5e01818002A0b672148bdC7514d861C7B3` | `0x5223dff6d08c3d6fe0b2c409295f3c3bdeb2f64f46771f2c923f405e716da668` |
| Sushi V2 router | `0x9A55D3d0c0f09859c7869510f53eD0a30B340766` | `0x77ab57d1f5d72bd6e600776f80718670a1c901e839ed4794378135c530f4c2d0` |

The official Swap API returned RedSnwapper `snwap` calldata for a harmless ETH-to-USDG
probe. RMT decoded and matched the sender, input token, exact input amount, recipient,
output token, 1% minimum received, native value, executor, and executor entrypoint. The
RedSnwapper, V2 router, V3 factory, and current executor were deployed by the same address.
RedSnwapper, the V2 router, and the V3 factory have verified source on Robinhood Chain;
the current route executor does not.

`apps/web/lib/server/sushi-swap-validation.ts` pins this boundary and rejects any changed
router, executor, entrypoint, bytecode hash, token, amount, recipient, minimum output, or
native value.

### Deadline guard release boundary

RedSnwapper's `snwap` function has no native deadline. `RMTSushiDeadlineGuard` supplies that
missing onchain boundary without changing Sushi's route execution. It is ownerless and has no
fee path, upgrade path, sweep, arbitrary recipient, or arbitrary executor. It permits only
ETH-to-token and token-to-ETH trades, binds the current RedSnwapper and route executor by exact
runtime bytecode hash, accepts only the reviewed route entrypoint, sends output directly to the
calling wallet, caps deadlines at ten minutes, and rejects replayed order IDs.

The integration remains fail-closed until the reviewed mainnet deployment is complete and all
three environment variables point to that exact deployment:

```text
NEXT_PUBLIC_RMT_SUSHI_DEADLINE_GUARD=0x...
RMT_SUSHI_DEADLINE_GUARD=0x...
RMT_SUSHI_DEADLINE_GUARD_CODE_HASH=0x...
```

The server verifies the configured guard bytecode before returning either an approval target or
executable swap. The browser independently requires the same public guard address, an onchain
deadline flag, and matching router and approval spender. Missing or changed configuration makes
Sushi execution unavailable rather than falling back to the deadline-free route.

The current Sushi route executor remains unverified source on Robinhood Chain. Runtime pinning,
calldata decoding, full wrapper simulation, minimum output and the wrapper deadline reduce
the execution boundary but are not a substitute for an independent audit.

### Verification and deployment

Unit and fork checks are nonbroadcasting:

```sh
cd packages/contracts
forge test --match-path test/RMTSushiDeadlineGuard.t.sol -vv
RMT_RUN_MAINNET_FORK=true forge test --match-path test/RMTSushiDeadlineGuardFork.t.sol -vv
```

The deployment script rechecks chain ID and both live code hashes before constructing the guard.
It changes chain state only when an operator deliberately supplies `--broadcast`:

```sh
cd packages/contracts
forge script script/DeployRMTSushiDeadlineGuard.s.sol:DeployRMTSushiDeadlineGuard \
  --rpc-url robinhood_mainnet
```

Run the command without `--broadcast` first. Before a real deployment, review the complete
simulation, deployment cost, deployer address, source-verification inputs, runtime hash and the
production canary plan. The script uses ordinary `CREATE`, so its address depends on the exact
deployer and nonce; a dry-run address is not a promised production address. Record the deployed
address from the confirmed receipt and independently verify its runtime hash before configuring
the web application. Use a Foundry keystore or hardware-wallet signer for the explicit broadcast;
do not place a private key in the repository, shell history, command line, hosted environment, or
deployment documentation.

## External market adversarial checks

`pnpm --filter web test:external-sushi` proves that external quotes fail closed when:

- the requested pair disappears or a different pair is returned;
- the chain or venue changes;
- the token is absent from the pair;
- the market URL is outside DEX Screener's Robinhood Chain namespace;
- liquidity drops below RMT's display threshold;
- the upstream response is malformed or unavailable.

`pnpm --filter web test:sushi-trade` separately verifies quote token metadata and rejects
changed route tokens in addition to the pinned execution-boundary tests.

Official references:

- Sushi Quote API: https://docs.sushi.com/api/examples/quote
- Sushi Swap API: https://docs.sushi.com/api/examples/swap
- Sushi SDK RedSnwapper registry: https://github.com/sushi-labs/sushi/blob/master/src/evm/config/features/red-snwapper.ts
- Sushi RedSnwapper interface: https://docs.sushi.com/contracts/red-snwapper
- Sushi Robinhood Chain pool interface: https://www.sushi.com/robinhood/pool
