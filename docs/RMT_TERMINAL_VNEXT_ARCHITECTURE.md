# RMT Terminal VNext Architecture

Status: **CURRENT — canonical forward architecture; production cutover incomplete**

Last reviewed: 2026-08-07

## Decision

RMT Terminal VNext will be an account, portfolio, intent, execution, authorization, and settlement system. Sushi, Uniswap, UniswapX, 0x, 1inch, PancakeSwap, and later chain-specific providers are infrastructure beneath RMT rather than top-level product modes.

The Robinhood Chain implementation comes first. Shared contracts carry chain identity from the beginning, but this document does not authorize another chain, bridge, provider, fee, contract, approval, order, or transaction.

The product loop is:

```text
wallet-owned assets
        |
        v
settled Spend Balance + portfolio
        |
        v
user intent: what I have / what I want / amount
        |
        v
request-time provider fanout
        |
        v
normalized candidate economics
        |
        v
route policy + user review
        |
        v
provider-specific exact verification
        |
        v
user authorization
        |
        v
confirmed settlement
        |
        v
updated settled Spend Balance
```

## Product invariants

1. RMT remains non-custodial. A displayed account aggregates wallet information; it does not create an internal liability or give RMT unilateral spending authority.
2. Spend Balance represents settled, wallet-owned assets. Pending incoming funds are visible but not spendable.
3. Asset identity is chain-specific. Symbol, name, and logo are metadata, never identity.
4. The directory can display an asset without asserting that a route exists.
5. The market-data source and execution provider are independent.
6. Market-risk warnings do not silently become transaction-integrity blockers.
7. Unknown authorization fields, routers, reactors, recipients, inputs, outputs, fees, order types, or domains fail closed.
8. The complete economics exist before authorization and are verified again after the wallet produces a signature or transaction.
9. Provider comparison happens only after the user requests a quote. The directory does not fan out execution requests across market cards.
10. No bridge, approval, fee, treasury action, or balance movement happens automatically.

## Bounded first release

Terminal VNext phase one is Robinhood-native:

- chain `eip155:4663`;
- canonical wallet-owned USDG as the preferred Spend Balance asset;
- asset-to-asset exact-input trading first;
- fast directory discovery independent of execution readiness;
- portfolio detection independent of the RMT launch directory;
- existing Sushi and direct Uniswap behavior adapted behind the new boundary;
- additional providers admitted only after the read-only benchmark and provider-specific verifier review.

The canonical Robinhood registry currently identifies USDG at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` and WETH at `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`. Addresses remain deployment configuration verified against primary sources and runtime code; they are not scattered UI constants.

## Domain contracts

The executable TypeScript contracts live in `apps/web/lib/vnext/execution-domain.ts`.

### Chain and asset identity

`ChainRef` uses a namespace and reference:

- Robinhood: `eip155:4663`
- Base: `eip155:8453`
- BNB Chain: `eip155:56`
- Solana mainnet: `solana:mainnet`

`AssetId` combines `ChainRef` with one chain-native locator:

- native currency;
- EVM contract address;
- Solana mint.

Examples:

```text
eip155:4663/contract:0x5fc5...d168
eip155:8453/contract:0x5fc5...d168
solana:mainnet/mint:So111...11112
```

The first two examples are different assets even though their address strings match. Metadata never participates in the key.

### Account and balance

`WalletAccount` binds an address to a chain. An RMT account may later aggregate several wallet accounts without pretending their funds share one ledger.

`AssetBalanceSnapshot` separates:

- `settledAtomic`;
- `pendingIncomingAtomic`;
- `pendingOutgoingAtomic`;
- `reservedAtomic`.

Spendable value is settled minus pending outgoing and reserved value. Pending incoming value is excluded until chain-specific settlement confirmation succeeds.

Global portfolio and available-dollar figures are valuations, not onchain balances. Every valuation needs an as-of time, confidence state, and source. A stale or unavailable price cannot be rendered as a precise current dollar balance.

### Intent

`TradeIntent` records:

- source account;
- input and output asset identity;
- exact input or exact output amount;
- recipient;
- user execution preference;
- request timestamp.

It does not contain a pool, venue, router, Permit2 address, calldata, EIP-712 domain, or provider order. Those belong to provider candidates and authorization plans.

### Candidate

`ExecutionCandidate` is a normalized, provider-neutral economic summary. Capabilities are a set because one route can be an RFQ, Dutch auction, and gasless execution simultaneously.

The candidate contains:

- provider and adapter version;
- exact input/output identities and amounts;
- exact recipient and, for exact-output trades, maximum input;
- provider-gross and user-net expected/protected output;
- one explicit RMT fee commitment, including an explicit disabled commitment while collection is off;
- separately denominated fee lines;
- authorization summary;
- settlement mode and estimate;
- policy decision;
- verifier identity and expected targets;
- quote and expiry timestamps;
- an opaque server-side quote reference.

It does not contain a raw provider response. Raw payloads may contain vendor-specific data, signature material, or fields the shared client is not qualified to interpret. They remain short-lived server-side data addressed by an opaque reference and fingerprint.

The canonical fee commitment and net math are defined in [`RMT_EXECUTION_REVENUE.md`](RMT_EXECUTION_REVENUE.md). A policy descriptor is not activation, and a quote cannot invent a treasury or implicit percentage.

### Authorization plan

An `AuthorizationPlan` binds one verified candidate to:

- one provider family;
- one authorization kind;
- one payload hash;
- one verifier and version;
- one expiry no later than the underlying quote.

Provider-specific verifiers create these plans. The shared engine cannot manufacture or alter provider authorization data.

### Settlement

`SettlementRecord` supports synchronous transactions, asynchronous intent fills, and later multi-step routes. A wallet prompt, signature, order acceptance, or submitted transaction is not settlement.

Only a chain-specific confirmation policy can move a session to `settled` and release confirmed output into Spend Balance.

## State machines

### Asset route state

```text
DETECTED
   |
   v
ROUTE_CHECKING ---- transient failure ----> TEMPORARILY_UNAVAILABLE
   |                                            |
   |                                            +---- retry
   v
TRADEABLE | NO_ROUTE_FOUND | POLICY_RESTRICTED | UNKNOWN_REVIEW
```

`NO_ROUTE_FOUND` means the completed provider set found no route for the requested pair, amount, and time. It is not a permanent property of the asset.

### Execution session

```text
DRAFT -> QUOTING -> REVIEWING -> VERIFYING -> READY_FOR_AUTHORIZATION
                                                    |
                                                    v
                                               AUTHORIZING
                                                    |
                                                    v
                                            PENDING_SETTLEMENT
                                                    |
                                                    v
                                                SETTLED
```

Any applicable state may terminate in failed, expired, or cancelled. Retry returns to a fresh draft/quote cycle; RMT never reuses a stale candidate or authorization plan.

The transition reducer rejects illegal transitions. In particular:

- quoting cannot jump directly to authorization;
- a candidate cannot authorize with blockers or unknown eligibility;
- submission cannot claim confirmation;
- settlement requires a confirmed record with a confirmed timestamp and output amount;
- a settled session cannot silently begin another execution.

## Service boundaries

### Directory service

Owns identity, metadata, price/liquidity snapshots, lifecycle, search, and cached route hints. It does not produce authorization data.

### Portfolio service

Owns asset detection, balance snapshots, valuation, spam visibility, and account aggregation. Detection does not grant tradeability.

### Execution orchestrator

Accepts a validated intent, selects eligible adapters, requests quotes concurrently within a latency budget, normalizes economics, and returns candidates. It has no signing authority.

### Provider adapter

Owns provider request/response translation, provider timeouts, rate limits, and a redacted quote reference. Adapter success is not authorization readiness.

### Provider verifier

Owns exact router/reactor/spender/domain/order/calldata verification, simulation requirements, and runtime allowlists. Each provider family has independent authorization configuration. There is no global Permit2.

### Route policy

Rejects ineligible candidates, then compares remaining candidates according to the user's selected mode. It must compare protected net outcome in a common valuation currency only when every conversion is sufficiently fresh and trustworthy.

### Settlement reconciler

Tracks transactions and open orders, distinguishes unknown from failed, confirms final output, and triggers a portfolio refresh. It never retries value-moving actions automatically.

## Warnings and blockers

Warnings include market risk such as token age, holder concentration, thin liquidity, price impact, unknown creator, and one-sided activity. They remain visible during review.

Blockers protect authorization integrity and policy boundaries, including:

- wrong chain, provider, router, reactor, spender, domain, or order type;
- wrong recipient, input, output, amount, minimum output, or fee;
- stale quote/order or mismatched payload hash;
- failed exact simulation;
- insufficient settled balance;
- known sell failure;
- explicit policy restriction.

Policy eligibility and route availability are independent. A technically executable RWA route can still be policy restricted.

## Data and telemetry

Collect normalized, non-secret execution evidence:

- chain and canonical asset keys;
- amount bucket rather than unnecessary wallet-level precision where possible;
- providers asked and timeout/failure categories;
- quote latency, expiry, expected/protected output, disclosed fees, gas payer, and settlement mode;
- winner and alternatives;
- verifier result code/version;
- submission, fill, fallback, confirmation, and latency outcomes.

Do not log full calldata, typed data, signatures, approval payloads, API keys, unrestricted wallet histories, or raw provider quotes. Analytics cannot become an alternate execution database.

## Release gates

No new provider can reach wallet authorization until all are true:

1. primary-source deployment and API support verified;
2. runtime bytecode/proxy implementation strategy reviewed;
3. provider-specific verifier and adversarial tests complete;
4. read-only benchmark demonstrates incremental value;
5. failure, expiry, cancellation, and recovery tested;
6. UI discloses exact economics, gas payer, approval spender, and settlement mode;
7. telemetry and provider kill switch operational;
8. small-value canary separately authorized.

## Explicit non-goals

- no production provider integration in this foundation change;
- no custody or internal credit;
- no cross-chain execution or automatic bridging;
- no RMT fee activation;
- no treasury execution;
- no NFT or RWA authorization;
- no advanced orders;
- no Sushi deadline-guard deployment or PR #313 changes;
- no claim that every detected asset is tradeable.

## Primary references

- Robinhood contracts: <https://docs.robinhood.com/chain/contracts/>
- UniswapX Robinhood rollout: <https://github.com/Uniswap/UniswapX/blob/main/playbook/chains/robinhood.md>
- PancakeSwapX addresses: <https://developer.pancakeswap.finance/contracts/pcsx/addresses>
- 0x supported chains: <https://docs.0x.org/docs/introduction/supported-chains>
- 1inch swap modes: <https://business.1inch.com/portal/documentation/apis/swap/swap>
