# Pump.fun Behavioral Comparison and RMT Market Specification

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

Production allocation must be explicit:

- public curve inventory: transferred directly to the market;
- graduation inventory: contract-reserved;
- optional creator allocation: disclosed and vested;
- optional community allocation: held by a dedicated treasury contract;
- no undisclosed creator-controlled inventory.

## Candidate curve

The first implementation candidate is a virtual constant-product market.

- `virtualEthReserve * virtualTokenReserve = k`
- Buying adds net ETH to the virtual ETH reserve and removes tokens from the virtual token reserve.
- Selling adds tokens to the virtual token reserve and removes ETH from real reserves.
- Virtual reserves shape the initial price; real ETH reserves cap sell payouts.
- Integer rounding must always favor solvency, never free-value cycles.

This remains a candidate until simulations and invariant tests pass. Exact virtual reserves, fee rate, graduation target, and inventory split are not production constants yet.

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

The market charges one disclosed fee on buys and sells. The fee is forwarded or accrued to the token-specific reward vault. The reward vault owns the immutable creator/community/trader/liquidity/platform split.

No transfer tax is added to the ERC-20 token.

## Graduation

Graduation is triggered by a deterministic threshold, likely real ETH accumulated or public inventory sold. The final threshold will depend on verified Robinhood Chain DEX infrastructure and required initial liquidity.

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
11. Trading is impossible after graduation.
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
