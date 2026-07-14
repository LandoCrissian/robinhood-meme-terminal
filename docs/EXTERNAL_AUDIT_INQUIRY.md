# Independent smart-contract review inquiry

## Subject

RMT V6 pre-deployment review — policy-driven launches, bonding curve, Fair Start, and Uniswap V4 fee flywheel

## Inquiry

Robinhood Meme Terminal (RMT) is seeking an independent security review of its V6 release candidate before deployment or activation on Robinhood Chain mainnet.

V6 includes fixed-supply clone launches, policy-bound bonding-curve markets, optional Fair Start controls, one-time graduation into a permanently locked Uniswap V4 full-range position, permissionless V4 fee realization, immutable 70/30 creator/protocol fee routing, a shared launch gate, expandable delayed governance, and delayed factory-version activation.

### Exact target

- Repository: https://github.com/LandoCrissian/robinhood-meme-terminal
- Candidate pull request: https://github.com/LandoCrissian/robinhood-meme-terminal/pull/112
- Review commit: to be frozen before engagement
- Chain: Robinhood Chain mainnet (`4663`)
- Current V5 registry: `0x4b8b222B5CAa7066c02A54E51eC1a674ADf5b3A1`
- Current expandable governance: `0x13C0A930516FB6bF0d467B38605d9D2a9c4C6953`
- Canonical V4 PoolManager: `0x8366a39CC670B4001A1121B8F6A443A643e40951`
- Public beta: https://www.rmtlaunch.fun
- Full handoff: [EXTERNAL_AUDIT_HANDOFF.md](EXTERNAL_AUDIT_HANDOFF.md)
- Threat model: [SECURITY_REVIEW_SCOPE.md](SECURITY_REVIEW_SCOPE.md)
- Release sequence: [V6_MAINNET_RELEASE.md](V6_MAINNET_RELEASE.md)

The primary review is pre-deployment. After fixes are accepted, the reviewer must confirm the final compiled artifacts and perform a deployed-bytecode, constructor, binding, policy-hash, and governance verification before public launches reopen.

### Requested expertise

We need senior Solidity reviewers with direct experience in:

- bonding-curve reserve accounting and clone initialization
- Uniswap V4 hooks, PoolManager settlement, fee realization, and concentrated liquidity
- reentrancy and callback systems involving native currency and ERC-20 tokens
- delayed governance, launch gating, and version-registry transitions
- economic attacks, MEV, sandwiching, sybil behavior, and denial of service

### Requested deliverables

- severity-rated report with reproducible evidence
- independent tests or proof-of-concept code for critical/high findings
- review of the permanent-liquidity and permissionless-collection claims
- economic, MEV, and Fair Start assessment
- remediation review tied to the exact final commit
- post-deployment bytecode and immutable-configuration confirmation
- publishable final report naming reviewed commits and deployed addresses

Any unresolved critical or high finding blocks deployment or reopening. Please provide proposed reviewers, relevant V4/AMM experience, start date, duration, fixed or capped quote including fix review, exclusions, publication terms, and comparable public reports.
