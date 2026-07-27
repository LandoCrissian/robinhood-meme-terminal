# Sushi integration

RMT integrates Sushi in stages so a new venue cannot weaken the verified V6 execution path.

## Current stage: verified in-terminal quote discovery

- `apps/web/lib/server/sushi-trade.ts` calls Sushi's official v7 Quote API for Robinhood Chain (`4663`).
- The same-origin `/api/trade/sushi-quote` route accepts only an origin-verified active V6 launch ID and matching token address.
- The same-origin `/api/trade/external-sushi-quote` route supports external Sushi markets in Terminal only after RMT independently re-verifies the exact token, pair, Sushi venue, Robinhood Chain identity, DEX Screener URL, and minimum live liquidity.
- Terminal displays Sushi's token metadata, exact estimated output, RMT's 1% minimum output, and price impact. The response must match the requested token, pair, wallet, side, amount, and chain or the client rejects it.
- Responses are explicitly marked `executable: false`. RMT does not forward opaque aggregator calldata to a wallet.
- `NoWay`, partial fills, changed input amounts, invalid output amounts, excessive/invalid price impact values, upstream failures, and timeouts fail closed.
- V6 launch previews remain off unless both `NEXT_PUBLIC_RMT_SUSHI_QUOTES_ENABLED=true` and `RMT_SUSHI_QUOTES_ENABLED=true` are intentionally deployed. External Terminal quotes require the server-only `RMT_SUSHI_QUOTES_ENABLED=true` flag.

The current production Uniswap V4 graduation and execution path remains unchanged.

## Execution gate

Do not enable Sushi execution until Sushi confirms the canonical Robinhood Chain deployment addresses and recommended integration surface. Before execution can ship, RMT must:

1. Pin and verify the exact router/factory/quoter bytecode and deployment boundaries.
2. Decode and validate minimum output, recipient, token path, deadline, and native-token handling instead of trusting opaque calldata.
3. Use exact, expiring approvals where supported and never request an unlimited allowance by default.
4. Simulate buys and sells against a Robinhood Chain fork, including zero-liquidity, partial-fill, high-price-impact, taxed-token, and malformed-response cases.
5. Keep the canonical V6 Uniswap path available as a rollback and avoid splitting launch liquidity across venues by default.

### Verified Robinhood Chain boundary

Read-only verification was refreshed on 2026-07-27 against Sushi's official SDK at commit
`f3be96d13f5cca54589b0509c46bb8bdb2583f03` and live Robinhood Chain bytecode:

| Contract | Address | Runtime bytecode hash |
| --- | --- | --- |
| Sushi RedSnwapper | `0x8E6fD69A77e88ee20Ba4B4fBd59DfCDA3EC0E98A` | `0x4b299d0674c86f701924420b3c90e4eb8efcc49f7865cc9680ee631ec7048b97` |
| Current route executor | `0x0e867974275Cd31C25015C2753C9d75F9f355379` | `0x57d45a1dce631a859bd1780826e0fbb9a7489650453406e0dc593724eca6cb6b` |
| Sushi V3 factory | `0xE51960f1B45f1C9FB6D166E6a884F866fC70433B` | `0x1d515a200d61f60a4075b5895f5f282b05e0772ca0749f9fa1589e981165d5f0` |
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
native value. It deliberately returns `executable: false`.

### Remaining blocker

RedSnwapper's `snwap` function has no onchain deadline. A client-side quote timestamp is
not an equivalent protection because a wallet can submit a signed transaction later. The
current executor is also not source-verified on Robinhood Chain. Therefore RMT will not
forward Sushi Swap API calldata to a wallet yet. The safe next implementation is either:

1. a Sushi-supported execution surface with an enforceable onchain deadline and verified
   executor source; or
2. a separately reviewed RMT deadline guard that pins RedSnwapper and the allowed executor
   bytecode, uses exact approvals, and is exercised on a Robinhood Chain fork.

Production Sushi execution remains disabled.

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
