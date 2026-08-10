# KITTENS Flywheel Protocol — RMT Labs

Status: **experimental source foundation only**. No KITTENS contract, pool, hook, vault, executor, or liquidity position described here is represented as deployed or production-ready.

KITTENS is an isolated RMT Labs experiment intended to prove a constrained token-economic primitive on CashCat Chain before RMT considers offering any version of the primitive to outside creators.

## Goals

- one fixed-supply token with no privileged mint, pause, blacklist, transfer tax, proxy, or hidden owner path;
- one canonical KITTENS/native-CASHCAT Uniswap v4 pool;
- a fixed 1% hook-level economic fee denominated only in native CASHCAT;
- deterministic 70/10/10/10 accounting of that native fee value;
- permanently non-removable canonical liquidity principal at the hook boundary;
- permissionless release of fixed-recipient paymaster and operations reserves;
- no public creator factory and no generalized launch product until KITTENS proves the mechanism under real conditions.

## External CashCat Chain evidence

CashCat Chain currently publishes the following mainnet configuration. These are third-party deployment claims and **must be reverified against runtime bytecode and the live chain immediately before any RMT deployment**.

| Item | Published value |
| --- | --- |
| Chain ID | `2274228` |
| RPC | `https://rpc.cashcatchain.cash` |
| Explorer | `https://explorer.cashcatchain.cash` |
| Native currency | `CASHCAT` |
| WCASHCAT | `0x52E816c6F4f2491F5700F4C4Ed402398d637424B` |
| Permit2 | `0x324a54D46170B606FD9fce71F9f1b4405CDb9281` |
| Uniswap v4 PoolManager | `0xe29f8a25930545c6890e291867EBd5e7e4f90485` |
| Uniswap v4 PositionManager | `0x3fb0E0028664BEC3950b79F3C42Ae3d6C98AA633` |
| Uniswap UniversalRouter | `0x4609E29517f49e5b8bcC75449C8cD001D64256e2` |
| Uniswap V4Quoter | `0x8B82182D1611EBfC1C52Da8AE9B5583c9389b71A` |
| Uniswap StateView | `0x334Ba6c310fa58e6ED6C5AcF5839607ccb223A03` |

Primary project source: <https://cashcat.network/>

RMT does not infer endorsement, safety, immutability, audit status, or decentralization from those published addresses.

## KITTENS token

`KittensToken.sol` deliberately implements a minimal fixed-supply ERC-20 shape:

- name: `Kittens`;
- symbol: `KITTENS`;
- decimals: `18`;
- initial supply: `1,000,000,000 KITTENS`;
- no mint function after construction;
- no owner;
- no pause or blacklist;
- no transfer tax;
- no proxy or upgrade surface;
- holders may burn only their own balance.

The deployment plan must mint the entire initial supply to a reviewed bootstrap/liquidity controller contract. An operator wallet receiving the supply is **not** an acceptable production launch topology even if the wallet intends to seed the pool later.

## Canonical pool economics

The experimental pool is constrained to:

```text
currency0: native CASHCAT (address(0))
currency1: KITTENS
core Uniswap v4 LP fee: 0
hook economic fee: 1.00%
initial swap mode: exact-input only
```

Using a zero core LP fee is intentional for the experiment. It prevents the canonical pool's fee accounting from accumulating a second fee stream in whichever pool currency Uniswap happens to charge. The KITTENS hook instead accounts the entire disclosed economic fee in native CASHCAT.

### Buy

For an exact-input CASHCAT -> KITTENS swap, `KittensFlywheelHook` reserves 1% of the specified native CASHCAT input before the pool swap. The remaining 99% reaches the pool.

### Sell

For an exact-input KITTENS -> CASHCAT swap, the hook observes actual native CASHCAT output after the pool swap and reserves 1% of that native output. The trader receives the remainder.

KITTENS ERC-20 transfers remain untaxed. The fee belongs to this canonical pool hook, not to the token contract.

Exact-output swaps are intentionally rejected in the first version so fee basis and wallet protection can be proven without ambiguous input/output accounting.

## Fee lanes

Every native-CASHCAT fee amount authenticated by the canonical hook is credited into `KittensFeeVault`:

| Lane | Share of hook fee | Approx. effective basis at 1% hook fee |
| --- | ---: | ---: |
| KITTENS buyback/burn reserve | 70% | 0.70% |
| RMT/CashCat paymaster reserve | 10% | 0.10% |
| permanent-liquidity growth reserve | 10% | 0.10% |
| RMT operations/security reserve | 10% | 0.10% |

Integer rounding dust is assigned to the burn reserve so every credited wei has exactly one lane and lane totals always conserve the authenticated fee amount.

The vault has no arbitrary sweep. Forced or accidental native balances are not counted as fees and remain unaccounted unless the bound hook authenticates a matching fee transfer.

## Why burn and liquidity executors are not in this foundation

A naive permissionless executor that can submit an arbitrary `minOut` for a buyback can expose protocol reserves to sandwiching or intentionally bad execution. A naive liquidity compounder can create similar price-manipulation and range-selection risk.

For that reason this first source foundation **does not implement or enable a swap-based burn executor or liquidity compounder**. The vault reserves those lanes only for one-time-bound executor contracts, and it cannot finalize its topology until those executors exist.

A later executor candidate must independently prove at minimum:

- bounded slippage enforced by the contract rather than trusted caller input;
- an oracle/TWAP or other manipulation-resistant price boundary, or an equivalently constrained verified quote design;
- minimum execution size and cooldown/batching behavior;
- no arbitrary target or calldata execution;
- no ability to redirect acquired KITTENS or liquidity principal;
- keeper incentives that cannot be increased after finalization;
- exact buy -> burn conservation for the burn lane;
- exact add-liquidity -> permanently non-removable conservation for the liquidity lane;
- adversarial MEV, reentrancy, forced-balance, malformed-token, and partial-fill tests.

Until then, the reserves can be tested in source but must not be represented as an active flywheel.

## Liquidity boundary

`KittensFlywheelHook` permits canonical pool initialization and liquidity additions only from a one-time-bound controller contract. It rejects every liquidity-removal attempt, including attempts from that controller, and rejects v4 donations so donations cannot masquerade as economic activity.

Swaps start closed and can be opened only once by the bound liquidity controller after the deployment sequence has seeded and verified the pool.

The controller itself is not implemented in this foundation. A production controller must be a contract, must use deterministic initialization parameters, and must have no post-launch principal-removal path.

## Hook deployment constraint

Uniswap v4 encodes hook permissions in the low bits of the hook contract address. The production hook therefore cannot be deployed to an arbitrary address. A later deployment script must CREATE2-mine a salt whose resulting address exactly matches `KittensFlywheelHook.getHookPermissions()` and then verify the deployed runtime code and permissions before pool initialization.

Unit tests may override BaseHook address validation only to test hook behavior at ordinary local addresses. That test escape hatch must never exist in the production hook.

## Required release sequence

No mainnet deployment should occur until a later reviewed change proves all of the following:

1. Re-read CashCat Chain ID, RPC, explorer, bridge and every required Uniswap v4 deployment from primary sources.
2. Fetch and pin runtime bytecode hashes for PoolManager, router/quoter/state contracts and any deployment dependency actually used by RMT.
3. Add a CashCat Chain fork rehearsal against a fixed block and prove the exact pinned chain state.
4. Implement and test the deterministic KITTENS liquidity/bootstrap controller.
5. Implement the burn executor with enforceable price/MEV protection and one-way KITTENS burn conservation.
6. Implement the liquidity executor with enforceable price protection and permanently locked resulting principal.
7. CREATE2-mine and verify the production hook permission address.
8. Deploy the complete topology on a fork and prove construction/binding/finalization ordering cannot be bypassed.
9. Execute exact buy and sell simulations through the intended RMT wallet route.
10. Run formatting, build, contract-size checks, the complete Forge suite, static analysis and invariant/fuzz coverage.
11. Obtain independent human smart-contract review before representing the flywheel as production-ready.
12. Use a deliberately bounded mainnet canary deployment and verify every receipt, balance delta, event and sell path before exposing KITTENS publicly in RMT.

## Public-launch boundary

KITTENS is not a creator launch template. The experiment must first demonstrate truthful accounting, reliable execution, locked liquidity, keeper behavior, market survivability, chain reliability and operational observability.

Only after those gates pass should RMT consider extracting a constrained `Flywheel Launch` primitive. Any future public version requires a separate architecture and security review; KITTENS success does not automatically authorize a generic factory.
