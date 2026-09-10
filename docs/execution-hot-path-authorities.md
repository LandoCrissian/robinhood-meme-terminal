# Execution hot-path authorities

Base: `897355ece0f35a5682f416d7abad395dd7720bba`.

## Proven blocking boundary before this change

`TradeIntentComposer.requestLiveRoutes` creates an exact chain/account/asset/amount
request from the selected canonical market. It does not await holders, liquidity,
activity, origin, social or risk enrichment. The protected quote handler validates
the request and Privy-linked recipient, then awaits
`readVNextVerifiedAssetIdentity` for both assets. That reader previously called
`readRobinhoodTokenIdentity` for every ERC20 and returned null on RPC failure. It
never consulted the indexer's persisted verified identity shard. Consequently a
durably known PEEP could produce `IDENTITY_UNAVAILABLE` before any 0x request.

The quote, verification and authorization handlers also passed address-only
candidates to project admission, discarding their already-read identities. This
could repeat metadata RPC and await project-registry freshness. Native ETH was
already a local chain primitive and must remain so.

Before:

```text
intent -> exact context validation -> authenticated linked wallet
       -> live ERC20 metadata RPC
       -> project registry freshness / duplicate metadata reads
       -> 0x price observation -> selected public route
       -> identity reads again -> Stock Token execution policy
       -> authoritative 0x firm quote / strict verification
       -> identity reads again -> committed authorization / simulation
       -> explicit wallet review -> receipt -> settlement evidence
```

## Four authorities

| Authority | Trusted inputs | What it does not authorize |
| --- | --- | --- |
| Directory / identity | Chain 4663, exact contract, verified onchain name/symbol/decimals, strict authenticated indexer evidence, positive project conflicts | A usable route or successful trade |
| Market intelligence | Observed activity, liquidity, holders, origin, social and informational risk evidence | Wallet access, token admission by labels, or trade execution |
| Execution | Exact authenticated wallet and amount, current Stock Token exclusion, one authoritative firm 0x envelope, fee/target/minimum/runtime checks, allowance/balance and simulation | Settlement success |
| Settlement | Receipt plus exact ERC20 Transfer reconciliation or native-output trace reconciliation | Approval receipt or generic transaction receipt alone is insufficient |

After:

```text
intent -> exact context validation -> authenticated linked wallet
       -> trusted durable ERC20 identity (native ETH: local)
       -> known positive conflict check / Stock Token exclusion
       -> 0x observation -> authoritative firm quote
       -> unchanged strict verification / committed authorization / simulation
       -> explicit wallet review -> unchanged settlement verification

fresh metadata / project intelligence -> bounded background revalidation
                                     -> update evidence or retain outage status
                                     -> positive conflict blocks later preparation
```

The indicative price response remains an observation, never executable authority.
The existing firm-quote commitment, expiry and exact-envelope machinery remains
authoritative. No new route provider, writer, database or wallet-signing facility
is introduced.

## Failure distinctions

Trusted durable evidence is read server-side from the existing authenticated,
strictly validated canonical inventory response, not from browser-supplied
metadata, DEX labels or arbitrary token lists. A cold process can require a
bounded indexer read; this is an identity authority lookup, not live metadata
rediscovery. Unknown tokens still require a successful trusted onchain read.

Temporary metadata failure does not negate established identity. A verified
decimals/code/identity conflict is different and must block. Positive project
quarantines are checked before any deferred intelligence work. Fresh project
discovery is scheduled through the request lifetime rather than awaited before
quoting. Existing Stock Token execution exclusion remains fail-closed; its
authoritative registry availability is not interchangeable with informational
market metrics.

No holder, liquidity, activity, origin or risk provider is added to the execution
dependency set. On a warm authority cache the local identity preparation needs no
metadata network call. On a cold cache the exact durable authority read remains
necessary. Authentication and current execution-policy checks remain required.

## Wallet and approval boundaries

Connection is a bounded user intent, not an unbounded spinner. A later explicit
provider choice supersedes earlier asynchronous work. Announced UUID is only a
session-local instance identifier; account, chain and provider binding still
need current validation. Ambiguity requires selection.

One Sell intent may orchestrate approval confirmation, verified allowance, a
fresh firm quote, strict verification and simulation, then wallet swap review.
Background identity or quote work never signs or submits a transaction. Each
wallet confirmation remains the user's security boundary.

## Acceptance scope

The hot-path browser fixture uses the real Next.js protected quote route and
strict indexer reader with network-only fixtures, a locally signed test identity
bound to the local test verifier, and no real wallet. It forces live metadata and
external intelligence unavailable and checks four PEEP directions, unknown
identity, wrong chain, malformed input and Stock Token exclusion. Identity and
project-authority tests exercise conflict, coalescing and deferred revalidation.
Existing full wallet, firm commitment, settlement, directory and multi-page
browser acceptance remains required; a price response alone is not a simulation
or funded-trade claim.
