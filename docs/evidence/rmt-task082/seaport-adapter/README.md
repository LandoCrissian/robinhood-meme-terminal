# Read-only exact-order verifier

`packages/launchpad-common/seaport-order-verifier.mjs` has no package, Node,
network, wallet or filesystem imports. The application injects its existing
cryptographic/ABI functions and a read-only provider. Trusted pins, reviewed
terms and provenance are application inputs, **never copied from order/API JSON**.

```js
const verifier = createSeaportVerifier(viem);
const result = await verifier.verifySeaportOrder(order, {
  profile: "robinhood-4663-read-only-v1", rpc, witnessRpc,
  pins, review, provenance, nowMs: Date.now()
});
```

The exact schema is declared in the companion `.d.mts`. Production-chain reads
require a separately configured witness and compare every response at the same
numbered block. The local chain-31337 profile is explicitly synthetic. The
adapter never chooses a network from a URL or ticker. It bounds orders to 32 KiB,
one NFT offer, eight consideration items, eight pins per allowlist, 128 provider
observations, a 15-second total read budget and at most five seconds per wave.

Supported orders are static-price FULL_OPEN, zero zone/hash, one exact ERC-721 or
ERC-1155 identifier and quantity, and native ETH or one source-verified immutable
ERC-20. Mixed payment assets, tips, dynamic prices, partial/contract/restricted
orders, bulk signatures, unresolved criteria and unrecognized conduits are
rejected. Offerer signatures support canonical 65-byte ECDSA and EIP-2098, or a
separately source/runtime-pinned immutable ERC-1271 verifier. Unknown contract
signers, delegated signers and proxy identities are unavailable. This intentionally
does not infer support for every wallet or Seaport order form.

The verifier independently derives the Seaport 1.6 domain, component hash and
EIP-712 digest, compares `information` and `getOrderHash`, checks the current
counter/status, exact seller ownership and operator approvals, and rechecks the
canonical block. A historical observation cannot become a current listing.
Current-listing provenance would need an independently authenticated bounded
transport binding its raw response, order hash, chain, venue and observation time.
This module has no such transport. Caller-supplied source names, response hashes
or times **never** establish a verified live listing: chain-4663 current-source
requests remain `CURRENT_LISTING_SOURCE_UNPROVEN`, even when their signature and
on-chain state can be inspected. A collection URL supplies no order evidence.

All signed consideration is compared to the exact reviewed recipients, roles and
amounts. Marketplace fee recipients are explicitly admitted; there is no assumed
universal OpenSea fee. RMT's optional royalty admission policy compares current
ERC-2981 at the disclosed **all-in** sale-price basis, in the same payment unit.
This is **not** a claim that Seaport enforces ERC-2981. Unsupported or changed
royalty evidence is rejected. No off-chain royalty settings are modified.

Actual reserve balance and the reviewed reserve limit are distinct. When the
source-bound custody profile exposes RMT V1 budget views, the adapter checks the
project/controller, epochs, exact available/accounted reserves, enabled flag,
collection/runtime/standard/token-ID admission, currency, per-NFT/lifetime/day
limits and cooldown. A receiver contract alone
does not prove any treasury accounting. ERC-20 payment allowance must equal the
exact all-in cost for route preconditions; missing or excessive allowance leaves
the route unavailable. The helper never creates an approval.

Where the provider permits it, an internally reconstructed
`fulfillAdvancedOrder` call uses numerator/denominator 1, empty extra data and
criteria, zero fulfiller-conduit key and the exact vault recipient. It is submitted
only through `eth_call`, with bounded gas and zero/native exact consideration.
Successful terms simulation does not prove controller authorization, actual NFT
custody or custody accounting. No arbitrary API calldata is returned or executed.

The original Task 081 vault cannot execute Seaport orders or credit custody from
an unsolicited Seaport delivery. In particular, genuine Seaport ERC-721 transfers
may use `transferFrom` without its safe-receiver callback. Its Seaport custody
capability remains **unconditionally false**, even if caller metadata wrongly
claims support or a transfer itself could complete. No future policy kind is
admitted through a configuration flag. This version consequently reports every
route unavailable while separately exposing signature/state, collection policy,
allowance and terms-simulation evidence. **Every result reports execution and
purchases disabled.** A positive read-only observation is not permission to spend.

`mocked-unit-tests.json` retains the actual local ten-group test result and source
hashes. Its mocked RPC observations are separate from genuine Seaport fixture and
fork evidence. Ephemeral ECDSA signatures are genuine but not owner signatures.
The initial uncommitted hash-domain development error is retained separately; it
was corrected rather than hiding or weakening an assertion.

Primary references: [Seaport orders and fulfillment](https://github.com/ProjectOpenSea/seaport/blob/117019831a71efb46108e379d1a873a631731dc4/docs/SeaportDocumentation.md),
[ERC-2981](https://eips.ethereum.org/EIPS/eip-2981),
[ERC-1271](https://eips.ethereum.org/EIPS/eip-1271).

**BLOCKED_NO_BROADCAST.** Existing economics, contracts, owner keys, production
providers, Firebase and Railway remain unchanged by this read-only module.
