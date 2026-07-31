# Pump.fun Behavioral Comparison and RMT Market Specification

> **Historical comparison:** This document records the clean-room behavioral baseline that informed RMT. It is not the V6 release specification. [V6_PROTOCOL_FOUNDATION.md](V6_PROTOCOL_FOUNDATION.md) controls all V6 supply, fee, Fair Start, graduation, liquidity, and governance behavior.

## Source policy

Pump.fun does not publish an identifiable official production-contract repository. Public GitHub results are third-party recreations and are not treated as authoritative. RMT will use a clean-room implementation based on observable product behavior, onchain transactions, official public fee disclosures where available, and independently verified formulas.

## Shared product behavior

RMT should preserve the proven launch lifecycle:

1. A creator supplies token identity and metadata.
2. A factory creates a fixed-supply token and a launch market.
3. Public inventory is controlled by the market, not the creator.
4. Buyers and sellers trade against deterministic reserves.
5. Every trade enforces slippage limits.
6. Disclosed fees are accounted for exactly once.
7. Progress toward graduation is public and deterministic.
8. Graduation can occur only once.
9. Curve trading stops after graduation.
10. Reserved assets migrate through an approved DEX adapter.
11. The same token remains indexed after graduation.

## EVM-specific differences

RMT uses ERC-20 contracts, contract storage, wei-denominated ETH, Solidity ABIs, EVM transaction ordering, pull-payment rewards, reentrancy guards, and explicit DEX adapters. Solana program-derived accounts, SPL-token accounts, CPI, rent, and account locking are not portable concepts.

## Production contract graph

```text
MemeLaunchFactory
├── FixedSupplyMemeToken
├── BondingCurveMarket
├── LaunchRewardVault
└── GraduationVault / approved DEX adapter
```

## Supply custody

The alpha factory currently mints the full token supply to the creator. That behavior is not permitted in the production market template.

V6 mints exactly 1,000,000,000 tokens directly into the launch pipeline and transfers the full supply to the market. The creator receives no launch allocation. Unsold tracked inventory migrates with the exact tracked ETH reserve at graduation; purchased tokens remain with buyers.

## Candidate curve

The first implementation candidate is a virtual constant-product market.

- `virtualEthReserve * virtualTokenReserve = k`
- Buying adds net ETH to the virtual ETH reserve and removes tokens from the virtual token reserve.
- Selling adds tokens to the virtual token reserve and removes ETH from real reserves.
- Virtual reserves shape the initial price; real ETH reserves cap sell payouts.
- Integer rounding must always favor solvency, never free-value cycles.

V6 fixes these values per immutable policy. The reviewed mainnet policies use a 1% curve fee, 0.3 virtual ETH, 1,017,500,000 virtual tokens, and a 2 ETH net graduation target. Final release still requires the V6 checklist and independent review.

## Required trade interface

### Buy

Inputs:

- recipient;
- minimum tokens out;
- deadline.

Checks:

- market active;
- nonzero ETH input;
- deadline not expired;
- quoted output does not exceed public inventory;
- output meets `minimumTokensOut`;
- fee and reserve accounting balance exactly.

### Sell

Inputs:

- token amount in;
- minimum ETH out;
- recipient;
- deadline.

Checks:

- market active;
- token allowance and balance sufficient;
- deadline not expired;
- payout does not exceed real ETH reserves;
- output meets `minimumEthOut`;
- effects occur before external ETH transfer;
- reentrancy is blocked.

## Fee model

The V6 market charges one disclosed 1% fee on curve buys and sells. The token-specific splitter routes 70% to the current creator-share recipient and 30% to RMT. After graduation, the locked V4 position charges a 0.5% pool fee and applies the same 70/30 split to collected ETH and/or launched-token swap fees.

No transfer tax is added to the ERC-20 token.

## Graduation

V6 graduation is triggered when the tracked real ETH reserve reaches exactly 2 ETH net of curve fees. The final buy is clamped and excess ETH is refunded or left as a payer-controlled claim.

The threshold-reaching buy closes the bonding curve and records graduation; it does not make an external DEX call. After that confirmation, `migrateLiquidity()` is a permissionless, one-time finalization transaction that moves only the tracked reserve and inventory into the canonical Uniswap v4 position. The caller pays gas but receives no ETH, tokens, liquidity ownership, or reward.

Graduation must:

- be irreversible;
- stop curve trading before external calls;
- use only an approved adapter;
- prevent arbitrary liquidity recipients;
- publish token and ETH amounts migrated;
- publish resulting pool and liquidity-position identifiers;
- define treatment of unsold inventory and residual ETH;
- keep reward liabilities separate from liquidity assets.

## Security invariants

1. Total token supply never increases.
2. Market inventory plus externally held inventory equals total supply, excluding explicit burns.
3. The market cannot pay more ETH than its real reserve.
4. Fees are collected exactly once per trade.
5. Fee funds cannot be counted as graduation liquidity.
6. Buy output never exceeds market inventory.
7. Sell output never exceeds available real reserves.
8. A buy immediately followed by a sell cannot produce risk-free profit before external price movement.
9. Rounding cannot create value through repeated dust trades.
10. Graduation happens at most once.
11. Curve trading is impossible after graduation; trading continues in the canonical Uniswap v4 pool after migration.
12. Creator, fee, reserve, and adapter parameters are immutable per launch.
13. No privileged address can withdraw public inventory or real reserves.
14. All external ETH transfers use checks-effects-interactions and reentrancy protection.
15. Failed reward-vault or migration calls fail safely without corrupting reserve state.

## Test plan

- exact quote tests at boundary values;
- fuzz buys and sells across inventory ranges;
- invariant conservation of token and ETH accounting;
- round-trip loss/non-profit invariant;
- fee-accounting invariant;
- reserve-solvency invariant;
- deadline and slippage failures;
- malicious ERC-20 and malicious receiver tests;
- reentrancy tests;
- graduation race and double-graduation tests;
- DEX-adapter failure and partial-state tests;
- gas and contract-size checks;
- economic simulation before selecting production constants.

## Explicit non-goals

- copying unofficial Pump.fun clone code;
- reproducing Solana-specific implementation details;
- hiding admin controls;
- promising price appreciation or creator income;
- deploying a curve before adversarial and economic testing.
