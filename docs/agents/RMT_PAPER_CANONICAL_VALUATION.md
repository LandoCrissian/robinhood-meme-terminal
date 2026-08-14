# RMT canonical paper valuation

**Status: PAPER ONLY — durable-state-bound portfolio valuation**
**Admitted:** 2026-08-14

`PaperCanonicalValuationService` prevents Arena valuation from trusting caller-supplied balances or position books.

## Authority chain

The service loads `AgentStateStore` itself and retains:

- stream ID;
- canonical persisted revision;
- complete engine snapshot;
- canonical engine-state hash;
- self-contained liquidation valuation;
- final record hash.

The paper account is selected from the canonical engine snapshot. Paper fills for that account are selected from the same snapshot. The position book is rebuilt from those fills and then valued using fresh full-position liquidation quotes.

## Cross-layer validation

A canonical valuation is accepted only when:

1. `engineStateHash = hash(canonical engine snapshot)`;
2. valuation account snapshot exactly equals the account in that engine snapshot;
3. a fresh position book rebuilt from the snapshot's paper fills has the same book hash as the valuation;
4. the self-contained liquidation valuation independently validates;
5. the entire canonical valuation record hash validates.

This is stronger than hashing a caller-provided account. Even if an attacker changes an account balance and recomputes the outer hashes, the account/position reconstruction must still agree with the retained canonical engine state.

## Persistent-store relationship

The PostgreSQL agent state store already recomputes and validates its stored `state_hash` before accepting a persisted snapshot. The canonical valuation layer then binds Arena valuation to that accepted revision.

## Explicitly absent

This layer does not:

- mutate paper balances;
- create orders or fills;
- accept free-form portfolio state;
- sign transactions;
- submit live execution.

Future Arena performance and leaderboards should consume canonical valuation checkpoints, not raw UI balances or arbitrary NAV numbers.