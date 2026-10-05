# RMT — Robinhood Meme Terminal

RMT is a mobile-first, non-custodial discovery and trading terminal for **Robinhood Chain mainnet (chain ID 4663)**.

- **Application:** https://www.rmtlaunch.fun
- **Status:** https://www.rmtlaunch.fun/status
- **Risk disclosures:** https://www.rmtlaunch.fun/risks

RMT is independent software. It is not Robinhood Markets, Inc., an official Robinhood product, or evidence of endorsement by Robinhood or any integrated protocol or data provider.

## Current mission

Finish one production user loop and make it dependable:

```text
DISCOVER
→ SEARCH
→ SELECT MARKET
→ INSPECT CURRENT DATA
→ CONNECT THE EXACT EXTERNAL WALLET
→ ENTER TRADE
→ RECEIVE A CURRENT QUOTE
→ VERIFY EXECUTION
→ APPROVE WHEN REQUIRED
→ REVIEW IN WALLET
→ SUBMIT
→ TRACK
→ RECONCILE SETTLEMENT
→ VERIFY USER OUTPUT
→ VERIFY RMT FEE SETTLEMENT
→ REFRESH BALANCES / POSITION
→ RECOVER SAFELY FROM FAILURE OR UNCERTAIN STATE
```

A passing build, a provider quote, a connected wallet or a successful transaction receipt is not by itself production acceptance. RMT treats settlement and recovery as part of execution.

## Product order

RMT is intentionally being completed in stages:

1. **Human trading** — make same-chain discovery, wallet execution, settlement and recovery work reliably.
2. **Settled revenue accounting** — independently reconcile RMT trading fees after execution.
3. **Community distribution** — build downstream CCFF00 and approved-project reward mechanics from verified settled revenue. Distribution must never sit in the user's swap hot path.
4. **Expansion** — agent/API trading, user-controlled bots, tournaments and broader ecosystem systems come after the human terminal and revenue loop are proven.

Future distribution mechanics are product direction, not a current promise of yield, returns or asset value.

## Token Terminal

The Token Terminal is designed around a broad Robinhood Chain market universe rather than a fixed curated ceiling.

RMT keeps these concepts separate:

- **asset existence** — a token exists onchain;
- **market existence** — a market/pool exists;
- **directory visibility** — RMT can surface the asset;
- **curation / owner approval** — an explicit RMT ecosystem designation;
- **project identity** — evidence binding an asset to an independently established project;
- **market maturity** — objective market evidence such as liquidity, age and sustained activity;
- **execution eligibility** — whether the current asset pair may enter the trading hot path.

Missing social, holder, chart, origin or other enrichment data should be represented truthfully; it should not automatically turn an otherwise valid ordinary token into an execution ban.

RMT may later expose maturity-oriented categories such as **Established** using objective onchain/market evidence. Such labels must not be represented as guarantees that an asset is safe or profitable.

## Public execution authority

Current public Token Terminal execution is deliberately narrow:

- **Network:** Robinhood Chain mainnet, chain ID `4663`
- **Execution provider:** `zero-x-swap` only
- **API:** 0x Swap API v2 / AllowanceHolder
- **RMT integrator fee:** 25 bps (0.25%) in the exact sell token
- **Custody:** non-custodial
- **Stock Tokens:** view-only / execution-ineligible under current policy

Historical Sushi, Uniswap V2/V3/V4, UniswapX, PONS, UP and custom execution code may remain for compatibility, discovery, evidence or historical purposes. Their presence in the repository does **not** authorize them as public execution fallbacks.

RMT must never receive or control a user's private key, seed phrase or recovery phrase. Wallet actions require explicit user authority.

### Execution security

The execution path preserves independent checks for, among other things:

- exact chain;
- exact connector-qualified wallet;
- exact assets and amount;
- trusted token identity;
- positive project-identity conflict policy;
- Stock Token policy;
- current firm quote;
- RMT fee parameters;
- allowance spender and amount;
- transaction target/value;
- reviewed 0x deployment/runtime authority;
- executable protected minimum;
- balance and allowance;
- RPC simulation;
- committed authorization;
- post-approval re-verification when required;
- duplicate protection and recovery.

A quoted fee is not a settled fee. A successful approval is not a successful swap. A successful receipt is not sufficient by itself to claim verified settlement.

## Discovery and market data

RMT combines canonical/indexed market inventory with bounded live discovery and enrichment.

Market-data fields should carry truthful provenance and freshness. Where appropriate, the application distinguishes states such as:

`READY`, `STALE`, `PARTIAL`, `UNAVAILABLE`, and `UNKNOWN`.

Curated markets are seeds, not the maximum market universe. Current-market usefulness should not require exhaustive historical backfill.

## Wallets

RMT's existing wallet architecture uses Privy, Wagmi/viem and connector-qualified external wallet selection, including EIP-6963-compatible paths.

The signing provider matters, not only the address. RMT must not silently switch between wallet providers merely because they expose the same address.

Real-device and real-wallet acceptance remains separate from mocked integration coverage.

## NFTs and Project Market

RMT also contains an NFT Terminal and Project Market foundations.

Token identity and NFT/project identity are separate authorities. A matching name, symbol, image or social profile is not enough to claim that a token and NFT collection belong to the same project.

Future approved-project reward mechanics may include token purchases or NFT acquisition/distribution, but they belong **after** trading settlement and revenue accounting. Failure of a downstream reward system must not interrupt ordinary terminal trading.

## Infrastructure

- `apps/web` — canonical web terminal, wallet, execution, evidence and recovery UI/server paths
- `apps/indexer` — deployed V6 event/history compatibility indexer
- `apps/market-indexer` — market inventory/indexing infrastructure
- `apps/external-origin-indexer` — external project-origin evidence
- `apps/nft-indexer` — NFT ownership/mint/transfer/burn evidence
- `apps/nft-marketplace-indexer` — NFT marketplace read evidence
- `packages/contracts` — deployed compatibility, security, experimental and historical contracts
- `packages/shared` — shared chain/market types
- `docs` — architecture, deployment, operations, security and historical records

Vercel serves the web application. Railway hosts indexing/data services. Interactive execution and historical/indexing workloads should remain operationally separable so backfill cannot starve a user trade.

## System-of-record documents

Read current source and these documents before substantial engineering work:

- [Architecture freeze](docs/ARCHITECTURE_FREEZE.md)
- [Active system map](docs/ACTIVE_SYSTEM_MAP.md)
- [Terminal completion gate](docs/TERMINAL_COMPLETION_GATE.md)
- [VNext architecture](docs/RMT_TERMINAL_VNEXT_ARCHITECTURE.md)
- [0x AllowanceHolder public execution](docs/RMT_ZEROX_ALLOWANCE_HOLDER_PUBLIC_EXECUTION_V1.md)
- [Execution hot-path authorities](docs/execution-hot-path-authorities.md)

Repository documents can age. Current `origin/main`, explicit owner authority, actual runtime call paths, live infrastructure evidence and current official provider documentation take precedence over stale descriptive prose.

## Paused / secondary systems

Creator/V7, community/profile expansion, Across funding expansion, experimental systems and other secondary product lanes must not distract from completing same-chain human trading unless a proven dependency requires them.

Preserved source does not imply current production authority.

## Development and verification

The project targets Node 22 and pnpm 10.12.1.

```bash
pnpm install --frozen-lockfile
pnpm audit:production
pnpm test:terminal-release
pnpm typecheck
pnpm build
```

Run the affected indexer, contract, security, visual and production-monitor suites for their respective domains.

Evidence classes matter:

- unit test;
- mocked integration;
- read-only live proof;
- controlled mainnet proof;
- production acceptance.

Do not cite a mocked smoke test as proof that a live provider, wallet or settlement path works.

## Security

RMT is financial software and fails closed at execution authorities that cannot be established safely.

Never commit RPC credentials, API keys, database tokens, Firebase Admin keys, indexer bearer tokens, wallet keys, recovery phrases or signed production transactions.

No terminal can guarantee that a token is safe, profitable or sellable in every future state. Users remain responsible for their trading decisions.

See the [risk disclosures](https://www.rmtlaunch.fun/risks), [incident response plan](docs/INCIDENT_RESPONSE.md), [security review scope](docs/SECURITY_REVIEW_SCOPE.md), and [third-party notices](docs/THIRD_PARTY_NOTICES.md).
