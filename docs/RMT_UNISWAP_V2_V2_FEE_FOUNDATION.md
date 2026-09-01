# RMT Uniswap V2 atomic input-fee foundation

Status: **SOURCE FOUNDATION ONLY — NOT DEPLOYED — NOT ACTIVATED**

`RMTUniswapV2FeeExecutorV2` extends the existing verified Uniswap V2 route model without changing the live Uniswap V3 release. It is an ownerless, non-upgradeable exact-input settlement primitive for the universal `RMT_EXECUTION_V2` policy. It has no admin, rescue, arbitrary target, arbitrary calldata, arbitrary path, token allowlist, or mutable fee/treasury surface.

The executor supports only a canonical direct pair or a canonical two-pair WETH hop. Every pair is resolved through the immutable factory and checked for exact factory, unordered token identity, deployed code, and the approved pair runtime hash. The path is constructed by the contract. Native and ERC20 input, ERC20 and native output, exact gross-input trader approval, exact provider-input Router approval, protected output, replay, deadline, runtime, residual, and transfer-delta checks are contract invariants.

Economics remain the shared policy:

- policy: `RMT_EXECUTION_V2`, version 2;
- policy hash: `0x91c988a28bd8b308e57bfbd3a991571b663f1c5d8430f96dfa1db2e5cfb93484`;
- treasury: `0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC`;
- fee: 25 bps, input side, floor of user gross input;
- provider input: gross input minus the exact fee;
- provider domain: `RMT_UNISWAP_V2_ROUTER_V2`, distinct from the V3 Router02 domain.

The server quote candidate is guarded by the server-only `RMT_VNEXT_UNISWAP_V2_FEE_CANDIDATE_ENABLED` variable. It defaults false, rejects malformed values, and rejects Production use while no deployment exists. When deliberately enabled outside Production with the complete V2 policy, it quotes the official V2 Router using provider input and emits the standard `feeV2Economics`. It never grants wallet authority.

The authoritative settlement registry therefore remains `QUOTE_ONLY` for `uniswap-v2`, with no implementation ID admitted. Existing direct/no-RMT-fee V2 verification remains preserved. Future deployment and future wallet/public admission each require separate owner decisions, an immutable deployment package, runtime verification, application admission, and controlled proof.

The opt-in fork suite uses the canonical Robinhood Chain Router, factory, WETH, and WETH/PONS V2 pair only as deterministic fork infrastructure. It broadcasts nothing. PONS is not an allowlisted fee asset or a public product preference.
