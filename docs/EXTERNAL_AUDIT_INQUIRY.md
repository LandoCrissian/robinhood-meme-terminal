# Independent smart-contract review inquiry

## Subject

RMT V4 deployed mainnet review — bonding curve, rewards, governance, and Uniswap V4 graduation

## Inquiry

Robinhood Meme Terminal (RMT) is seeking an independent security review of its deployed V4 smart-contract system on Robinhood Chain mainnet.

The system includes standardized fixed-supply token launches, clone-based bonding-curve markets, pull-based creator/community rewards, Fair Start anti-sniper controls, 2-of-3 delayed governance, a delayed factory-version registry, and one-time automatic graduation into Uniswap V4 liquidity.

### Exact target

- Repository: https://github.com/LandoCrissian/robinhood-meme-terminal
- Deployed release commit: `ce7573b36c924c6933907e7f214d74a215b796f8`
- Chain: Robinhood Chain mainnet (`4663`)
- Factory: `0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4`
- Registry: `0xfff3f69f473780EA5eA7f5525526986Bb491E00e`
- Public beta: https://www.rmtlaunch.fun
- Full handoff: [EXTERNAL_AUDIT_HANDOFF.md](EXTERNAL_AUDIT_HANDOFF.md)
- Threat model and scope: [SECURITY_REVIEW_SCOPE.md](SECURITY_REVIEW_SCOPE.md)
- Address inventory: [MAINNET_CONTRACTS.md](MAINNET_CONTRACTS.md)

All RMT-owned production contracts have published exact-match source records. The review must independently reproduce the deployed-bytecode/source match and verify constructor parameters and permanent bindings.

### Requested expertise

We need at least two senior Solidity reviewers, including direct experience with:

- AMM or bonding-curve reserve accounting
- Uniswap V4 hooks, PoolManager settlement, and concentrated liquidity
- clone initialization and minimal proxies
- governance/timelock systems
- economic attacks, MEV, sandwiching, sybil behavior, and denial of service

### Requested deliverables

- severity-rated report with reproducible evidence
- independent tests or proof-of-concept code for critical/high findings
- deployed-bytecode/source and immutable-configuration confirmation
- economic and MEV assessment
- remediation review
- final public report naming the exact reviewed commit and deployed addresses

Any unresolved critical or high finding blocks broad promotion.

Please provide:

1. proposed reviewers and their relevant Uniswap V4/AMM experience;
2. earliest start date and expected review duration;
3. fixed-price or capped quote, including remediation review;
4. scope assumptions and exclusions;
5. whether the final report may be published;
6. references to comparable public reports.

The system is already deployed as an explicitly unaudited, controlled mainnet beta. Existing markets cannot be rewritten. If remediation requires a new factory, the review must include version-transition and compatibility analysis.
