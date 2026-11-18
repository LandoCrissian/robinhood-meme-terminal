# Treasury V2 price and route feasibility

Task 077, source base `ecf3998f6e9b556c000de5c48908e4fb0b363fc8`. **NO-GO for treasury purchases; BLOCKED_NO_BROADCAST.** This is a dated read-only observation and source review. It authorizes no wallet call, keeper, oracle admission, launch, royalty change or production configuration.

## What was observed

The [bounded probe](../scripts/treasury-v2/routes.mjs) reuses `makeReadOnlyRpc` and the approved public official/Pocket endpoints. It pins one L2 block, reads code and view methods, then rereads that block. Its transport permits no signature or broadcast, bounds responses to 192 KiB, and retries a transient transport/rate-limit failure at most once with the existing eight-second attempt limit. The public feed catalog has a separate 512 KiB bound. Output is an absolute fresh file; an existing evidence file cannot be overwritten.

[Recorded observation](evidence/rmt-task077/routes-4663.json): **2026-11-18 22:29:08 UTC**, Robinhood Chain **4663**, block **117745635**, hash `0x89915491572d0a04a77d6d37c842b8742628e934eaee34f99ada478b2b50ce2f`. Both providers corroborated eleven exact runtime pins and twenty bindings/economic constants. This is corroboration of the same L2 state, not independent market evidence or Ethereum L1 finality.

| Role | Approved address | Evidence |
| --- | --- | --- |
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | Runtime matches approved release pin |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` | Runtime, PoolManager and Permit2 match |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Runtime matches |
| Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | Runtime and PoolManager match |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | Runtime and PoolManager match |
| Universal Router **2.1.2** | `0x204FAca1764B154221e35c0d20aBb3c525710498` | Runtime and PoolManager match |
| Directory V2 | `0xE677A69A8124714DD0d88b73BDf1B89cc791ca9C` | Runtime and current publication state observed |
| Registry V3 | `0xf1113714Dda31f31532995D2525e034271425398` | Runtime and Directory binding match |
| Normal token factory | `0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3` | Runtime, engine, registry, 1B supply and exact creation fee match |
| Graduation engine | `0x10e540536F10ed36E5fC6638638f1d862e552D32` | Runtime, factory, managers, Permit2, guard, chain/fee/tick spacing match |
| Initialization guard | `0x998F3C0CE20cFF92655D495a159B1Ca37c162000` | Runtime, manager, engine and low permission bits match |

The exact runtime hashes and complete per-provider responses are retained in the JSON. The production compiler closure remains `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`. Source hashes of the unchanged factory, token, curve math, graduation engine and guard are included separately; these repository sources include their explicit local chain gates and are not confused with the transformed production bytecode. Their explicit hash encoding is UTF-8 with CRLF normalized to LF only (`UTF8_CRLF_TO_LF_ONLY`). The original Windows checkout-byte hashes remain in `recordedRawSha256`. This corrects the Linux/Windows evidence-check mismatch without changing the original network observations, timestamps, checkpoint or contract bytes. Source content changes still fail the single normalized hash assertion; invalid UTF-8 is rejected.

Uniswap's [deployment page](https://developers.uniswap.org/docs/protocols/v4/deployments) lists both a generic Universal Router at `0x8876789976decbfcbbbe364623c63652db8c0904` and the explicitly versioned 2.1.2 address above. The [deployment repository](https://github.com/Uniswap/contracts/blob/main/deployments/4663.md) and [Trading API support table](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains) identify the approved 2.1.2 target. These are distinct version entries, not permission to change our pin. API decoding must preserve 2.1.2 per-hop protections. Chain support alone does not establish a hosted route for a particular guarded pool; no hosted quote was observed for an uncreated project.

## Actual project and liquidity boundary

At the observed block, both Directory reads returned `latestVersion = 0`, `factories(1) = (zero address, zero hash)`, `suspended = false`, and the original pending publication digest. Its real executable time remains **2026-11-19 23:32:28 UTC**, expiry **2026-11-26 19:50:06 UTC**. No action was executed. No new project token is assigned in this research. Historical V6 tokens and synthetic fixture tokens cannot fill that field.

Consequently, the production token, curve, PoolKey/PoolId, deposited assets, position, liquidity, trade quote and hosted route remain **unavailable for the new project**. The probe deliberately performs no fabricated token/pool query and no expensive chain-wide enumeration. It does not claim a total count of all historical registrations.

For a real admitted token, the canonical key is `(native ETH = address(0), token, fee = 3000, tickSpacing = 60, hooks = the exact guard)`, scoped to chain 4663 and the exact PoolManager. PoolId is the Keccak hash of all five ABI-encoded members; it is not a contract address. The guard's permission bits are `0x2000` (beforeInitialize only). Its source admits initialization only from the bound engine and does not implement swap/oracle observation hooks. The curve uses committed virtual-reserve quotes and actual backing; neither an opening price nor two observations of those reserves supplies an independent project market price. Uniswap documents that [v4 has no built-in oracle](https://developers.uniswap.org/docs/protocols/v3/concepts/price-oracles).

Previously retained [4663 synthetic fork settlement](evidence/fixed-supply-release/settlement-traces.md) proves guarded graduation and Router 2.1.2 native/token settlement for those exact isolated fixtures. Task 076 separately proves the same app's curve/v4 lifecycle on synthetic 31337. Neither evidence creates real production liquidity, an external market, an independent price reference, or a live hosted route.

## Independent reference research

Robinhood's [oracle documentation](https://docs.robinhood.com/chain/oracles-and-price-feeds/) points to Chainlink. The [Chainlink documentation source at commit 805757ca](https://github.com/smartcontractkit/documentation/blob/805757ca9294eb1fa14bf9e4b6b3ae66bd03b5f9/src/features/data/chains.ts) binds Robinhood mainnet to the [public catalog](https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json). The downloaded 62-entry catalog's raw SHA-256 was `9b21f1262fd333228743ce1987506ebfa9aa1296119db2a8aba93848db225339`. The probe records its bounded public identities; it never admits a feed from a ticker match.

Both RPCs observed ETH/USD proxy `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9`, eight decimals, aggregator `0x6091E64eb7138EEF066a80FD3A0d7427B91f2721`, matching runtime hashes, and round `18446744073709555197`. Its positive answer was `176375354680`, updated at Unix `1795038423`, **2525 seconds old at the pinned block**, within that catalog's 86400-second heartbeat. This is a dated **base-asset observation only**. The 24-hour heartbeat is not an approved purchase freshness policy. An ETH/USD price cannot determine the price of an uncreated project's token. Proxy implementation/owner changes, sequencer outages, grace periods, reference-market liquidity/history and project-token mapping need their own reviewed admission. Robinhood is not listed in Chainlink's [current sequencer-uptime feed roster](https://docs.chain.link/data-feeds/l2-sequencer-feeds); borrowing Arbitrum One's address would be invalid.

The [official Pyth contract roster](https://docs.pyth.network/pro/contract-addresses) lists Robinhood Pro `0xACeA761c27A909d4D3895128EBe6370FDE2dF481` and Core `0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a`. Both RPCs observed nonempty matching proxy runtimes (183 and 177 bytes). Their implementation authority, accepted project feed ID, feed-to-token mapping, publisher/market independence, confidence, freshness, update costs and project market coverage are **not admitted**. A proxy's existence is insufficient. Pyth explains its separate [Core/Pro feed identifiers](https://docs.pyth.network/pro/price-feed-ids); no feed is selected by an RMT name/ticker, no signed update was purchased or submitted, and no oracle infrastructure was deployed.

The specific missing prerequisite is an independently reviewed source **for the actual project token**, bound to its chain/address, with sufficient non-circular market liquidity/history, bounded freshness/confidence, manipulation and sequencer handling, and a canonical settlement route. The finding is not “no oracles exist on Robinhood” and does not predict that every future project is permanently ineligible. Until that evidence exists, the new prototype must remain hard-disabled.

## Trade-offs and launchability

| Case | Honest outcome |
| --- | --- |
| V1 non-purchasing treasury | Local funding, original fee claims, custody and noticed withdrawals work; immutable V1 cannot gain buys. Its six highs remain in their strict report. |
| V2 research prototype | May validate source-bound policy/quote/reference structure; no custody, approved route or independent project reference means **NOT EXECUTABLE**, not a deployable purchasing treasury. |
| New project on its curve | Committed math and actual backing are quotable. A third party can move curve state before execution; the same curve is not an independent reference. Reject unattended buys. |
| Graduated canonical v4 pool | Full key, real deposits, original position custody, router and settlement must match. Same-pool spot or same-pool TWAP is insufficient independence; a fresh thin pool may lack any external reference. |
| Independent ETH royalties/manual ETH | Economically distinct incoming capital; supported accounting does not grant trading authority. A later eligible route could spend only unreserved project ETH under accepted caps. |
| Fees already paid in the launched token | They already increase the treasury's token holdings. They are not ETH buying power; selling them and rebuying is circular, incurs costs and is not implemented. Native and token income stay separate. |
| WETH, USDC, arbitrary ERC-20 royalties | Unsupported by V1; no unwrap, cross-asset conversion, approval or arbitrary route is introduced. Do not redirect a marketplace recipient before currency support and a payment test. |
| Missing liquidity/reference, stale evidence, provider disagreement | Hold funds and report the exact unavailable condition; never substitute opening/current spot, fabricate settlement or retry a financial transaction. |
| Tiny deposits and dust | Quote fees plus gas can exceed benefit; no automatic transaction or guaranteed minimum accumulation buys. No principal can pay costs. |
| Permissionless trigger in a future version | Requires an external caller, gas and atomic controller/cap/route checks. No paid keeper, RMT signer or autonomous execution exists here. |

Public ordering exposes a buying policy to MEV. Caps, cooldown, min-output, deadline and independent reference checks can bound loss; they do not establish fair execution or eliminate sandwich risk. A maximum square-root-price movement must be squared before describing actual price movement. Claims of yield, price support, enforced royalties, automatic burns or distributions remain excluded.

## Reproduce and limitations

```sh
node --test scripts/treasury-v2/routes.test.mjs
node --test docs/evidence/rmt-task077/routes-evidence.test.mjs
node scripts/treasury-v2/routes.mjs /absolute/unused-live-observation.json
```

The eleven focused unit tests exercise exact cross-platform source hashing, address/PoolId identity, hook bits, stale/future/nonpositive/incomplete rounds, bounded/duplicate catalog data, wrong chain, missing RPC evidence, empty runtime, provider disagreement, and absence of all signing/broadcast methods. Retained-evidence checks replay the recorded identities without network access. The live probe checks only the two approved free providers and does not claim archive/trace SLAs, independent L1 finality or ongoing health. Initial observation `routes-4663-first.json` outside Git retained one Pocket 429 and its bounded successful retry; the final report records its own attempts. Live calls can later become stale or unavailable and never activate execution.

LAMMB Genesis royalties remain unchanged. A future RMT-bound treasury could receive separately authorized, supported royalties and eventually purchase its own RMT token only after reference/route admission. An unrelated project's treasury cannot buy RMT under that binding. Separate NFT spending and manually funded Reclaim remain outside this prototype.
