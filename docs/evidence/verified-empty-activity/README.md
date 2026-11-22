# Verified empty activity history

The factory was deployed on chain 4663 at block **116835102**. The November 22 production sample at 21:26 UTC found 10,626 registration checkpoints through **120909982**, a maximum registration span of 2,000 blocks and zero registered tokens. The activity cursor was **119321102**. Both RPCs returned factory account nonce **1**, zero accrued creation fees and the pinned runtime at the registration block. Railway had one writer and zero waiters. Registration, historical discovery and Netlify discovery returned HTTP 200. Authenticated market and activity reads returned 503 during backfill and anonymous reads returned 401. [Database and canonical headers](production-coverage.json) Â· [Factory observations](factory.json)

At 21:40 UTC the exact candidate SQL passed inside a read-only production transaction for **119424102â€“120917032** inclusive. The audit found zero pre-existing fast ranges. Both RPCs confirmed the predecessor and end hashes, end timestamp, nonce one and factory runtime. This established **1,492,931** eligible blocks at that observation. The worker retained its own cursor. [Read-only preflight](read-only-preflight.json)

## Which receipts can exist

The deployed compiler input has uncompressed SHA-256 `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`. The factory runtime has Keccak-256 `0x519d55e694263866896e05023834b124829173f13f42c5aea7e3ca2200c5a091`. The birth verifier pins the chain, deployment transaction, block hash, immutable factory and registry. [Deployed compiler input](../rmt-task091/governance/source-publication/solc-standard-input-4663.json.gz)

| Event source | Earliest possible admitted activity |
| --- | --- |
| Factory | Its constructor emits no event and deploys no child. Every successful creation deploys the token with CREATE2 and its initial curve with CREATE, registers the token, credits the creation fee and emits CurveCreated and CreationFeePaid in the same transaction. Reversion undoes those writes and child deployments. |
| Global fee payout | CreationFeesClaimed requires positive creationFeesAccrued. Only a successful create credits that counter. Unsolicited ETH cannot credit it. |
| Migration | Both factory migration paths require an existing source curve for the token. |
| Curve, creator ledger and graduation engine | The token's curve and ledger originate in its creation. The engine validates the factory's active curve for that token. LP collections require a graduated position and LP fee ledger. |
| v4 and Permit2 | The activity reader admits the exact graduated pool ID, or a registered token approval to the approved router. Third-party pools and approvals to addresses before registration are outside these histories. The first receipt scan includes the entire creation block and its receipts. |

## Evidence and recovery

Registration scans at most 2,000 blocks per transaction. Each transaction starts at its locked durable cursor and commits the canonical end and registrations together. The fast path checks the entire retained sequence from birth to the captured registration checkpoint, the exact database identity, the activity predecessor and absence of registrations or events in the proposed range. Legacy registration checkpoints store ends only. Two short intervals can look like one if an interior row disappears. The independent nonce check closes that ambiguity. A successful creation permanently raises the nonce of this immutable factory above one. Both providers must report one at the inclusive empty end, bracketed by canonical header checks.

The end is the earlier of the registration checkpoint and the block immediately before the first registered token. A typed historical-state pruning response falls back to bounded factory-log scans. Missing coverage, contradictory nonces and conflicting block observations stop the fast pass. The leased transaction rechecks the original proof before writing the end hash, time and next cursor together. It writes zero event rows.

The existing checkpoint table records each proven range durably. A span above 2,000 blocks is reserved exclusively for this proof. Every ordinary commit enforces the ceiling. The preceding row supplies its start, or the pinned deployment supplies the start of the first range. The structured commit log also records the nonce and exact registration anchor used at execution. The read-only query reconstructs the retained ranges and locates a covering registration checkpoint. A newly discovered earlier registration blocks market and activity reads, rewinds through the affected range and replays the creation block. [Range audit](ranges.sql)

## Worker-only handoff

1. Before draining, verify the old deployment `03645aed-76c6-435e-b837-c4c8685f29c8`, image `sha256:63b98c280188e98b438205bccb92aa3c716c6252f0a280be959396b7c86c368b`, its sole lease, the original volume and a current canonical registration anchor. The range audit must return zero rows on this pre-fast-forward worker. Retain the existing backup.
2. With separate owner approval, drain the old worker. Confirm zero lease holders, then start the reviewed archive with the existing environment and RPC budget. Confirm exactly one holder and zero waiters. Capture the resulting Railway deployment ID and image digest.
3. Verify the committed empty range in SQL, its end hash, timestamp and factory nonce on both RPCs, and the next registration/activity checkpoints. Sample Railway and Netlify discovery repeatedly. At aligned empty checkpoints require authenticated activity 200 with zero events, a proven absent market 404 and anonymous reads 401. If registration has occurred, verify its creation receipt and any same-block fills. Keep the existing two-hour monitor and use the range audit to distinguish certified spans from ordinary batches.
4. Stop the candidate on a lease, canonicality, event-completeness or sustained discovery failure. After lease release restore the recorded image. The old worker can resume from a genuine checkpoint. If its pre-096 market endpoint returns 503 for an absent token, retain that release hold. A contradictory checkpoint requires evidence review before serving it. Never repair the cursor by hand.
