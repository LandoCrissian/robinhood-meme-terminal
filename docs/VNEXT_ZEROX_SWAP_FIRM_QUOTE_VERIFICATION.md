# VNext 0x Swap Firm-Quote Verification Foundation

Status: foundation only; not admitted as VNext strict verification or wallet authorization

Last reviewed: 2026-08-09

## Purpose

This slice adds a server-only, fail-closed verifier for the 0x Swap API v2 AllowanceHolder **firm-quote envelope**. It is deliberately narrower than an executable provider integration.

The existing 0x Swap and Gasless adapters remain observation-only. They continue to advertise:

```text
strictVerification: false
walletAuthorization: false
```

The firm-quote verifier is not registered in the VNext provider adapter, is not exposed through `/api/vnext/verify`, and cannot enter route selection or wallet preparation.

## What the foundation verifies

When its complete server-only configuration is present, the verifier requests:

```text
GET /swap/allowance-holder/quote
```

It validates:

- Robinhood Chain request continuity;
- exact input asset, output asset, input amount, taker, and requested recipient;
- expected output and protected output continuity against the indicative floor;
- absence of an RMT/integrator fee;
- disclosed 0x fee shape;
- `issues.allowance`, `issues.balance`, `issues.simulationIncomplete`, and invalid-source evidence;
- exact AllowanceHolder target and allowance spender;
- transaction target, nonempty calldata, gas limit, gas price, and zero native value for the bounded ERC-20 flow;
- independently configured AllowanceHolder runtime bytecode hash;
- native network-fee balance;
- an exact read-only `eth_call` of the returned transaction when balance, allowance, and provider simulation evidence are ready.

Returned evidence contains only a calldata hash. Raw calldata is not returned or persisted.

## Why strict verification remains off

The firm-quote response provides the requested economics and transaction envelope, but it does not independently expose every settlement field encoded inside the AllowanceHolder/Settler calldata.

RMT has not yet admitted a versioned decoder that proves the encoded:

- recipient;
- output token and protected output;
- sell token and exact input;
- fee recipients and fee amounts;
- Settler action sequence and command semantics.

Requesting `recipient=<wallet>` is not a substitute for independently decoding the transaction that the wallet would authorize. Until that decoder exists and rejects unknown selectors or fields, this foundation reports:

```text
recipientCalldataDecoded: false
outputCalldataDecoded: false
strictVerificationAvailable: false
walletAuthorizationAvailable: false
admissionReady: false
```

## Server-only configuration

All values fail closed when absent or malformed:

```text
RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED=false
RMT_ZEROX_ALLOWANCE_HOLDER=
RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH=
RMT_ZEROX_API_KEY=
```

The AllowanceHolder address and runtime hash must be independently verified for Robinhood Chain before any hosted environment enables the verifier. This document does not approve a copied address or runtime hash.

## Explicit exclusions

This slice does not:

- change the public VNext verification API;
- advertise 0x strict verification;
- prepare an approval or swap transaction;
- return raw calldata to the browser;
- request a wallet signature or transaction;
- submit an order or transaction;
- enable 0x Gasless quote, signing, submission, or status tracking;
- modify production environment variables;
- deploy a contract;
- change Position Guard, fees, treasury behavior, or PR #313.

## Next admission gate

Before `zero-x-swap` can advertise strict verification, RMT must add and adversarially test a provider/version-specific calldata decoder. Only after that decoder proves all authorization-critical fields may a separate PR propose strict-verification admission. Wallet authorization remains a later, separately authorized gate protected by the client codec allowlist.

## Primary references

- 0x Swap API v2 migration and AllowanceHolder semantics: <https://docs.0x.org/docs/upgrading/upgrading-to-swap-v2>
- 0x contract architecture and AllowanceHolder behavior: <https://docs.0x.org/docs/core-concepts/contracts>
- Official 0x integration examples and allowance warning: <https://github.com/0xProject/0x-examples>
- 0x Gasless API v2, retained as a separate deferred lifecycle: <https://docs.0x.org/docs/upgrading/upgrading-to-gasless-v2>
