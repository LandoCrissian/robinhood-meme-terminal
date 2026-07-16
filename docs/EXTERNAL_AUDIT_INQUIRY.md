# Independent smart-contract review inquiry

## Subject

RMT V6 live-deployment review — bonding curve, Fair Start, governance, and Uniswap V4 fee flywheel

## Inquiry

Robinhood Meme Terminal (RMT) is seeking an independent security review of its live V6 deployment on Robinhood Chain mainnet. Public creation is open; the engagement must review canonical source, reproduce the build, exact-match deployed bytecode and configuration, assess the protocol and economics, and verify remediations.

V6 includes fixed-supply clone launches, policy-bound bonding-curve markets, optional Fair Start controls, exact-target graduation with nonblocking overpayment refunds, one-time migration into a permanently locked Uniswap V4 full-range position, permissionless V4 fee realization, fixed 70/30 creator/protocol percentages for both fee currencies, fee-source binding, donation rejection, a shared launch gate, active-factory enforcement, one fresh delayed governance contract that also holds protocol fees, and a fresh version registry governed by it and initialized to V5. V6 governance starts 1-of-1; any added or replacement signer must prove control and give expiring consent bound to the current epoch, exact add-or-replace action, affected signer, and next threshold, may revoke unconsumed consent before execution, and the first added wallet creates 2-of-2 quorum rather than a backup key. Creators cannot authorize, propose, choose, or directly change the fee recipient. The RMT signer may propose only an evidence-linked, replay-protected move between the immutable original creator and V6 governance treasury; any account may relay the exact approved call after the delay, and stale-nonce invalidation also requires governance approval. A narrow exact-identity/operator-only route launches a new official RMT token while ordinary launches remain paused and does not reopen the gate; it creates a new address and new one-billion-token supply and does not copy, swap, credit, or migrate old-holder balances.

### Exact target

- Repository: https://github.com/LandoCrissian/robinhood-meme-terminal
- Foundation pull request: https://github.com/LandoCrissian/robinhood-meme-terminal/pull/112 (architecture foundation only; not proof of the exact deployed-source revision)
- Review commit: reconstruct and freeze the exact production-compatible source revision before engagement; the deployed-source commit is not yet established by the public deployment record
- Chain: Robinhood Chain mainnet (`4663`)
- Legacy V5 identity factory: `0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD`
- Official legacy RMT identity/provenance anchor: `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C`
- Canonical V4 PoolManager: `0x8366a39CC670B4001A1121B8F6A443A643e40951`
- Public beta: https://www.rmtlaunch.fun
- V6 governance/treasury: `0x52c43239df8965eb27f26e115cc5ead11b35d5c3`
- V6 registry: `0x27c0269e16209eee149e2738d0819a2633f44246`
- V6 factory: `0x8e75c57079a01ce2094bc4187b78710887547651`
- Official V6 RMT token: `0xdBa33be56C89CC9fc014c4459028d7e5c7878671`
- Deployment record: [MAINNET_V6_DEPLOYMENT.md](MAINNET_V6_DEPLOYMENT.md)
- Full handoff: [EXTERNAL_AUDIT_HANDOFF.md](EXTERNAL_AUDIT_HANDOFF.md)
- Threat model: [SECURITY_REVIEW_SCOPE.md](SECURITY_REVIEW_SCOPE.md)
- Release sequence: [V6_MAINNET_RELEASE.md](V6_MAINNET_RELEASE.md)

The primary review is post-deployment. The reviewer must confirm the final compiled artifacts and perform deployed-bytecode, constructor, binding, policy-hash, receipt, and governance-history verification. Exact explorer source publication is not a substitute for independent bytecode reproduction.

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

Any critical or high finding requires immediate incident assessment, pausing affected functionality when available and warranted, remediation, and independent fix review before that functionality reopens. Please provide proposed reviewers, relevant V4/AMM experience, start date, duration, fixed or capped quote including fix review, exclusions, publication terms, and comparable public reports.
