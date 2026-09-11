# PR521 independent-review corrections

Base: `b88d8e5886bad08c04166e86640e48e10100d242`

Reviewed predecessor: `28d0cd6cb70fd1fa5b83767fa2fd938a08ecc98e`

## Immutable public authority

`zero-x-authority.ts` source-pins Robinhood Chain AllowanceHolder to
`0x0000000000001fF3684f28c67538d4D072C22734`. Environment configuration is
an assertion of that identity, not permission to select a different address.
Firm verification and readiness reject alternatives, including an alternative
with identical runtime or a separately configured matching runtime hash.
Independent bytecode verification remains required. Shared firm/plan parsing
also pins the spender before wallet review, dispatch, and recovery. Exact input
amount approvals remain unchanged; Settler is never the approval spender.

`requireVNextPublicExecutionProvider`, called by both owned verify and authorize
routes, now requires the exact `zero-x-swap` release scope AND that provider.
`isVNextPublicExecutionProviderReleased` applies the same immutable rule to
observations. Legacy/mixed/unset/malformed scopes cannot authorize a wallet.
Historical codecs, manifests, proof records and isolated codec tests remain.
Historical scope names/types are not current release authority.

Actual authorize-route negative tests additionally exposed a prior propagation
defect: a provider-scope 403 was normalized to `AUTHENTICATION_FAILED`. Reviewed
policy codes now retain their static typed meaning and non-retryability, including
invalid scope's HTTP 503. Genuine authentication failures remain distinct.

## Approval receipt semantics

FIXED (presentation only). Recovery marks a mined successful approval receipt
confirmed, but that does not establish the resulting allowance. The banner now
says "Approval transaction confirmed" and explicitly requires current allowance
and a fresh route. It no longer asserts exact allowance from the receipt.

Continuation already discards the pre-approval payload, requests fresh firm
verification and independently reads allowance. A zero allowance despite a
successful/non-standard approve remains `approval_required`, not a swap. The
composer's `repeatsConfirmedVNextApproval` boundary prevents another identical
wallet approval request. No extra allowance read or new retry loop was added.

## Exact RMT fee settlement proof: BLOCKED

Economics are unchanged: 25 bps, exact sell token, nearest-integer-half-up,
treasury `0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC`.

Firm verification checks requested/disclosed fee token and atomic amount; the
commitment binds those fields, treasury, and transaction calldata. This is NOT
independent proof of actual treasury delivery. Current output reconciliation
independently binds the mined envelope and proves the user's exact ERC20 net
receipt or native trace delivery. It does not prove the integrator fee.

Official fee parameters describe provider-native collection, not an RMT fee
settlement event. The reviewed Settler's BASIC action can make token calls or
native-value calls; the final slippage transfer proves user output, not a distinct
fee receipt. Receipt Transfer logs can establish exact-token treasury credit,
but no captured, independently reviewed fee-action attribution for the current
returned payload is available here. Do not label an arbitrary treasury credit
or quote disclosure as proven integrator-fee settlement.

Native sell is additionally outside the existing authenticated trace route's
contract: that route admits only transactions to canonical AllowanceHolder with
zero native value. A native-input direct-Settler transaction is excluded. This
task does not broaden that security boundary or invent a balance-delta heuristic.
No live transaction-specific fee proof was obtained. ERC20 and native fee
delivery are NOT reported PASS. `confirmedVNextFeePresentation` continues to
report provider-native fees as quoted, with transfer reconciliation unavailable;
verified user output is not relabeled as verified treasury delivery.

Sources inspected read-only:
- [Official fee API semantics](https://docs.0x.org/evm/0x-swap-api/guides/monetize-your-app-using-swap)
- [Reviewed BASIC implementation](https://github.com/0xProject/0x-settler/blob/95184a23336b52d99aaa528c5b1259e3bb04eafe/src/core/Basic.sol)
- [Reviewed final output transfer](https://github.com/0xProject/0x-settler/blob/95184a23336b52d99aaa528c5b1259e3bb04eafe/src/SettlerBase.sol)

## Narrow TOCTOU review

| Authority | Verification / commitment | Authorization / wallet boundary |
| --- | --- | --- |
| AllowanceHolder | Source-pinned address plus independent runtime hash | Configuration rechecked; selected-block outer runtime compared; shared firm/plan checks pin spender |
| Inner Settler | Exact decoded target; ownerOf(2), prev(2) only after successful current lookup; approved runtime/decoder | Eligibility, pause handling and runtime repeated at a fresh selected block; compared to commitment |
| Recipient/account/chain/assets/amount | Authenticated context and firm quote checked; HMAC binds evidence and request IDs/session/wallet | Commitment/context checked; plan/evidence/account/chain binding checked before mocked dispatch |
| Minimum/fee/calldata/target | Decoded final minimum and exact simulation; committed fee, calldata hash and target | No second quote substituted; exact committed plan and protected floor required |
| Freshness | Firm evidence maximum ten-second lifetime | Commitment expiry, plan expiry, wallet review runway and current intent/generation checks; expired preparation must refresh |

No duplicate provider pipeline was introduced. These are bounded snapshot and
dispatch checks, not a claim that chain state cannot change after authorization
or while the user reviews an external wallet. Final mined settlement still needs
independent output evidence. Existing current/previous/pause/runtime adversarial
controls and commitment mutation tests remain required.

## Evidence classification and controls

New tests use owned API handlers and external-boundary fixtures/mock wallets.
They are not live provider, Production trace, signature or settlement evidence.
Canonical holder/runtime controls, false/no-effect approval allowance controls,
all historical providers' negative authorization controls and approval wording
checks are integrated into the existing suite. Historical incidents' unavailable
payloads and banner attribution remain UNPROVEN.

The newly observed Settler runtime remains NOT REVIEWED / NOT ADMITTED.
Production is NOT declared stabilized. No merge, deployment, environment change,
fee change, real wallet request, signature, approval or transaction is authorized
by these corrections. PR520 remains separate and untouched.
