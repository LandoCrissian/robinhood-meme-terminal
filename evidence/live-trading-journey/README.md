# Live trading journey finalization

Base: `a79a78fd0025eb12456c4adbdde713a237439dba`.
Production was not changed. All wallet journeys use deterministic mock wallets;
live diagnostics only read identities, request quotes and run `eth_call` with
ephemeral funding overrides. No signature, approval or transaction was sent.

## Historical owner session

`production-session-forensics.json` derives exact transfers and approval from
public transaction receipts. Buy: 1 USDG spent, 46,359.241823037302757237 PEEP
received. The intervening approval authorized precisely that PEEP amount to
AllowanceHolder and transferred no tokens. Sell: that PEEP amount spent,
0.984366 USDG received.

The first Sell reached post-approval quote (200), verification (200), then
authorization (422) at 02:19:15.819 UTC. The exact retained request is in
`production-session-requests.json`. Its application log array was empty.
The rejected rule, owner-attributed provider request counts, simulation result
and any quote expiry are **not recoverable from the retained evidence**.
No claim is made that this 422 was an upstream 0x failure or an expired quote.

The source-level continuation defect is independently reproducible: one failed
post-approval authorization consumed the in-memory continuation attempt, and
page restoration lost the original intent. The correction bounds read-only
retries for explicitly transient phases and restores only exact, expiring
approval-intent metadata. Unknown authorization/policy failures remain blocked.

## Signer and quote state corrections

The durable preference previously compared a wallet key containing a reported
provider ID exactly. A new UUID could defeat reuse even when stable wallet
brand, connector, RDNS, account and chain matched. The fix permits only the
UUID-to-UUID change for the same stable binding, then independently checks the
unique announced provider's accounts, chain and request identity. Ambiguity,
changed account/chain/RDNS and absent preference still require selection.

Identity-unavailable responses now carry a bounded phase and explicitly report
that no provider request occurred. Quote-not-requested, provider no-route,
provider failure, policy rejection, expiry and verification states are distinct.
Operational events whitelist phases and booleans, never arbitrary errors,
provider bodies, credentials, addresses or transaction payloads.

## Live PEEP stability

`peep-live.json` and `peep-live.csv`: 20 observations for each of four directions.
79/80 identities were available; every one of those 79 observations reached
firm verification. Observation 18, PEEP -> USDG, stopped at identity verification
with zero provider requests. It is not labeled a route/provider failure.

| Direction | Observations | Identity ready | Firm verified |
| --- | ---: | ---: | ---: |
| ETH -> PEEP | 20 | 20 | 20 |
| PEEP -> ETH | 20 | 20 | 20 |
| USDG -> PEEP | 20 | 20 | 20 |
| PEEP -> USDG | 20 | 19 | 19 |

Identity availability: 98.75%. Provider and firm-verification availability,
conditional on identity readiness: 100%. These unfunded diagnostic identities
do not imply a funded live trade or simulation success.

## Frozen matrix

`matrix-live.json` and `matrix-live.csv` retain seed 5272840 and the same 50
contracts: 13 V2, 19 V3 and 18 V4 primary canonical-evidence classifications.
All execution is 0x, never a venue-specific executor. Each Sell uses the paired
Buy output when available, otherwise its frozen original amount.

| Outcome | Buy | Sell |
| --- | ---: | ---: |
| Firm verified | 44 | 24 |
| No route | 5 | 21 |
| Provider unavailable | 0 | 4 |
| Missing integrator fee, rejected | 1 | 1 |

68 firm envelopes received the existing funded read-only simulation: 65 PASS,
zero FAIL, three unsupported token storage layouts (TSGOV, ONE and CRMBS Sells).
Unsupported cases are not passes. Missing fees remain rejected. Artifacts bind
fees, exact input/output, targets, runtime hashes, minimum output and simulation
envelope; the deterministic evidence validator runs in trading-hardening CI.

The short-lived diagnostic Preview uses the existing authorized branch-scoped
credential internally. Its compiled diagnostic artifact is not a web release
or an exact-head web deployment. Failed credential-scope setup probes were
excluded from the observation sample rather than mislabeled as 0x outages.

## Browser acceptance

`browser-journeys.json` records 198 passing desktop/mobile cases with real local
production quote/verify/authorize handlers and mocked external RPC/provider/
wallet boundaries. New cases cover first-stage identity failure, post-approval
identity retry, quote expiry, provider recovery, page reload, UUID rediscovery,
account/chain change and rejected approval. Existing cases cover sufficient
allowance, WalletConnect, rejection, revert, missing settlement, exact settlement,
balance refresh, PEEP and Stock Token controls, and adversarial envelopes.

Approval continuation still verifies the receipt and allowance, obtains a fresh
authoritative quote, verifies/simulates it and invokes the bound wallet for its
own separate swap confirmation. It never signs or broadcasts outside that wallet
authorization. One RMT trade initiation is retained; necessary approval and swap
wallet confirmations remain separate.
