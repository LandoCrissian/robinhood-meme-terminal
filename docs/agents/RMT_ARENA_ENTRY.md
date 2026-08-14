# RMT Arena entry checkpoint

**Status: PAPER ONLY — immutable competition starting state**
**Admitted:** 2026-08-14

`PaperArenaEntryService` establishes the canonical starting point for an Arena participant before any trading history exists.

## Entry authority

The service loads the persisted agent-engine state directly and binds:

- stream ID and revision;
- complete engine snapshot and state hash;
- exact season;
- exact paper account;
- participant type and participant ID;
- quote asset;
- starting quote NAV;
- canonical account opening timestamp;
- final entry hash.

## V1 starting-capital rule

Arena v1 requires quote-only positive starting capital.

Any positive non-quote starting balance is rejected. Zero non-quote balances are harmless.

`startingNavQuoteAtomic` is exactly the canonical quote balance at entry.

## Anti-late-entry rule

The entry timestamp equals the canonical paper-account opening time. The state snapshot must contain:

- no paper order for that account;
- no paper fill for that account.

A participant cannot trade first, observe the result, and then declare a later starting point.

## Human/Agent note

The Arena entry record is participant-type generic (`AGENT | HUMAN`) so the scoring contract can be shared. The current deterministic paper engine still creates AGENT paper accounts only. Human paper-account admission remains a separate future engine change and must use the same Arena rules rather than a separate scoring system.

## Explicitly absent

Entry does not create capital, edit balances, create trades, or grant live execution authority.