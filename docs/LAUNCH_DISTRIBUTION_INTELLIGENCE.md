# RMT launch-distribution intelligence

RMT treats three facts as separate evidence:

1. **Launch origin** — which factory, launchpad record, or public project record created or listed the token.
2. **Liquidity market** — the exact token, pool, DEX venue, and Robinhood Chain market that currently trade.
3. **Distribution** — whether an external discovery product or launch protocol is independently confirmed for that token.

A live Uniswap or Sushi pool never proves launch origin. A verified launchpad
record never proves an individual token is visible in an external aggregator.
The UI must preserve those boundaries.

## Uniswap Launches

Uniswap announced the Launches beta on July 30, 2026. Its public announcement
names Bankr, Pons, Long, and other launchpads, and explains that projects land
distribution after launching into Uniswap markets:

- <https://blog.uniswap.org/launch-aggregator-explore-top-uniswap-launchpads-in-one-place>
- <https://blog.uniswap.org/robinhood-chain-is-live>
- <https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/deployments>

Uniswap does not currently document a stable public Launches feed API. RMT must
not depend on a private browser endpoint or scrape the Uniswap interface.
Instead, RMT can independently reproduce:

- an attributed Pons launch source;
- a matched live Uniswap pool;
- the official fact that Pons is a recognized Launches source.

That evidence is labeled **Recognized Uniswap launch path**. It is not labeled
as an individual Uniswap Launches listing unless a durable official data
surface becomes available and the exact token can be matched.

## Sushi Launch

A Sushi contributor has publicly announced Sushi Launch for Robinhood Chain,
but RMT has not found corresponding public production deployment documentation.
An ordinary Sushi pool does not prove Sushi Launch origin. RMT keeps the
distribution step in monitoring until Sushi publishes the relevant production
contracts, event schema, deployment blocks, and supported metadata flow. Only
then should an origin adapter be proposed and replay-tested.

## V7 readiness

V7 must emit enough durable evidence for any external aggregator to index an
RMT-native project without trusting RMT's frontend:

- exact factory and token addresses;
- creator and project identifiers;
- canonical metadata URI and content hash;
- launch transaction and block;
- pool venue, pair, and initialization transaction;
- tokenomics and rights-policy version;
- an explicit external-distribution status that never implies acceptance.

External submission, partner outreach, and production contract deployment
remain separate actions requiring explicit authorization.
