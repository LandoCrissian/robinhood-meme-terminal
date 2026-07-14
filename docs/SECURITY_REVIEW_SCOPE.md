# Independent Security Review Scope

## Review objective

Provide an independent assessment of the deployed RMT mainnet V4 system and its economic assumptions. The reviewer must not rely on RMT's existing tests as proof of correctness and must report critical, high, medium, low, and informational findings with reproducible evidence.

## Deployed scope

- launch factory and clone deployment/initialization
- fixed-supply token
- bonding-curve market and reserve accounting
- reward vault and rewards controller
- fair-start and anti-sniper restrictions
- graduation trigger and one-time state transition
- Uniswap V4 hook, router, adapter, and settlement
- protocol-purpose vaults and release delays
- three 2-of-3 governance contracts
- factory version registry and activation delay
- mainnet deployment scripts and immutable configuration

Canonical factory: `0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4`  
Version registry: `0xfff3f69f473780EA5eA7f5525526986Bb491E00e`

## Required threat analysis

- unauthorized minting, balance changes, or inventory withdrawal
- reentrancy and callback behavior
- reserve insolvency and ETH/token conservation
- rounding extraction and repeated dust cycles
- buy/sell quote manipulation
- frontrunning, sandwiching, same-block behavior, and bypass of fair-start limits
- clone initialization front-running or reinitialization
- creator/community reward misdirection
- governance signer replacement, proposal replay, cancellation, and delayed execution
- factory registry bypass or unsafe version transition
- graduation replay, partial migration, stuck assets, and arbitrary venue redirection
- Uniswap V4 hook permissions and settlement correctness
- malicious ERC-20 receiver, ETH receiver, wallet, router, or third-party contract
- denial of service and gas-bound loops
- mismatch between documented and deployed immutable parameters

## Economic review

Simulate low activity, whales, rapid buys, panic sells, oscillating trades, fee-on-rounding effects, target approach, post-target behavior, and migration liquidity. Review the 1% curve fee, virtual reserves, 1 ETH graduation target, reward splits, and anti-sybil/anti-sniper assumptions.

## Required deliverables

- report with severity definitions and proof for every finding
- deployed-bytecode and source-match confirmation
- list of reviewed commit SHAs and addresses
- review of existing fuzz/invariant/fork tests and independent additional tests
- remediation verification for critical/high findings
- explicit statement of unresolved assumptions and excluded scope

## Engagement handoff

Use [EXTERNAL_AUDIT_HANDOFF.md](EXTERNAL_AUDIT_HANDOFF.md) as the exact provider handoff, acceptance policy, and remediation workflow.

## Evidence package

- [Mainnet deployment record](MAINNET_DEPLOYMENT.md)
- [Launch readiness audit](LAUNCH_READINESS_AUDIT.md)
- [Incident response](INCIDENT_RESPONSE.md)
- Foundry source, scripts, tests, and generated deployment artifacts
- disposable launch/buy/sell/claim transaction hashes
- permanent mainnet-fork graduation workflow
