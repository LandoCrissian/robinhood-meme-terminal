# Sushi Launch discovery

RMT consumes Sushi's documented public Launch Data API as an additional market-discovery input on Robinhood Chain. This is a permissionless data and protocol integration; it is not a claim of partnership, endorsement, or token safety.

## Upstream boundary

- GraphQL endpoint: `https://production.data-gcp.sushi.com/api/graphql`
- Logo CDN: `https://cdn.sushi.com/tokens/4663/{lowercaseTokenAddress}.jpg`
- Robinhood Chain launch contract: `0x104F1Ab42674565EC3DF0BFEbCcC4186f72fA7ED`
- Query lenses: newest launches, 24-hour volume, and current TVL
- Refresh policy: 30-second shared cache with a seven-second request deadline

The adapter accepts only confirmed chain `4663` records whose factory equals the verified Sushi Launch contract and whose token, creator, and launch-pool addresses are valid. Invalid, malformed, wrong-chain, provisional, or wrong-factory records are discarded.

## Attribution boundary

Discovery does not automatically produce an attribution badge. RMT attaches Sushi Launch identity only after the API token and exact launch-pool address match the independently discovered live DEX pair. A generic Sushi pool remains labeled as a Sushi market without claiming Sushi Launch origin.

Launch origin never increases a market's runner score. Ranking continues to use liquidity, two-sided activity, volume, acceleration, price behavior, and market age. Execution still requires an independently verified Sushi or Uniswap route and a fresh wallet-reviewed quote.

## Failure behavior

The three query lenses fail independently. Partial upstream failure marks the source refresh delayed while preserving verified DEX data and any successful Sushi metadata. Missing logos fall back to token initials in the interface. Complete upstream failure contributes no Sushi candidates and cannot block the rest of market discovery.
