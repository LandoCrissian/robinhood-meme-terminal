# RMT Agent Engine

**Status: paper-only foundation. Not a production service.**

The initial engine registers agents, creates immutable strategy versions, activates paper-only agents, records auditable decision summaries, tracks probabilistic predictions, opens paper accounts, accepts paper orders, enforces delayed/hash-bound quote evidence, settles simulated costs by asset and reports current prediction Brier score.

It intentionally has:

- no HTTP server;
- no database yet;
- no signer or private key;
- no wallet submission;
- no contract-write path;
- no provider or fee activation;
- no live execution method;
- no production environment dependency.

The next admitted implementation phase is isolated PostgreSQL persistence plus durable event/account records. Live execution remains a later VNext typed-intent bridge and is not implemented here.
