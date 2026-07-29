# RMT Live community foundation

## First release

RMT Live begins with one global public room and a room identifier model for reviewed project pages. It supports pseudonymous guests and verified members without exposing Firebase IDs, emails, wallet addresses, IP addresses, or raw presence records.

All message creation is server mediated. Firestore permits public reads of visible messages but denies direct client creation, editing, and deletion. The server verifies the Firebase identity, normalizes content, assigns the public identity class, enforces per-IP and per-identity limits, checks temporary restrictions, and writes a private moderation actor record separately from the public message.

## Identity boundary

- Guests use Firebase Anonymous Authentication and receive a stable `Guest-XXXX` label derived with a server secret.
- A guest is not a profile, verified creator, or RMT representative.
- Verified Google members may use their protected display name and handle.
- Project-creator and RMT labels are derived from server-side ownership and administrator records, never from client input.
- Profile sync ignores anonymous Firebase sessions, so a guest cannot create or mutate a protected profile document.

## Abuse and safety boundary

- Five-second posting cooldown.
- Hourly identity quotas, stricter for guests.
- Guest links are blocked.
- Recovery-phrase and private-key sharing prompts are blocked.
- Message length is capped at 500 characters.
- Raw community actor records are private and cannot be read or written by clients.
- Every visible message can be reported using a bounded reason. Duplicate reports from the same identity are idempotent and self-reporting is rejected.
- Reports, reviewer identifiers, restriction state, and moderation audit records are server-only.
- The verified RMT administrator may dismiss a report, hide a message, or apply a one-hour or 24-hour posting restriction with a required review note.
- Hiding a message removes it from public Firestore queries; moderation never changes wallets, profiles, token ranking, verification, or trading state.
- Structured product feedback supports bug, feature, mobile, trading, market-data, creator-tool, and other categories.
- Full feedback and administrator notes remain server-private. A separate public marker contains only its identifier, category, and progress status.
- Guests may submit three feedback items per day and verified members ten, with a two-minute cooldown.
- Feedback status follows an audited forward-only path: submitted, under review, planned, shipped or closed.
- A submitting browser retains at most 12 random feedback receipt identifiers locally and can follow their limited public progress markers under Updates.
- Receipt identifiers are locators, not authentication secrets. They never grant access to the private submission, identity key, or administrator note.
- Withdrawal requires the same authenticated Firebase identity that submitted the feedback. It deletes the private content and keyed author record, closes the public marker, and leaves only a minimal private audit event with no message text or identity key.
- Direct messages, media uploads, link previews, wallet tips, trading calls, and ranking influence are not part of this release.
- Community engagement does not alter Runner ranking, token risk, or verification.

Every community write retains the fast in-memory request guard and also consumes a transactional Firestore bucket shared by all server instances. The durable bucket identifier is an HMAC of the validated forwarding address and operation namespace; RMT does not persist the raw network address. Records contain only the operation namespace, bounded count, reset time, expiration time, and update time. Identity-specific cooldowns and quotas still apply separately, so changing server instances does not bypass either layer.

The Firestore limiter is appropriate for a measured initial rollout, not unlimited adversarial traffic. It adds one read and, for accepted attempts, one write. Monitor usage and place a reputable edge limiter in front of the application before a large public campaign or if rejected traffic itself becomes material.

## Retention and acknowledgement

RMT Live requires one versioned browser acknowledgement before posting a message or submitting feedback. The rules prohibit scams, impersonation, harassment, unlawful or infringing material, spam, personal or confidential information, market manipulation, malicious links, and wallet-compromise content. Updates remain readable without accepting the posting rules. A materially changed rules version requires a new acknowledgement.

New records carry these maximum TTL targets:

| Record | Retention target |
| --- | ---: |
| Public messages | 90 days |
| Private reports and feedback | 180 days |
| Limited public feedback status | 365 days |
| Private moderation/feedback audit | 365 days |
| Private community actor state | 365 days after activity |
| Presence | 4 minutes |
| Distributed request bucket | Until its fixed window resets |

Firestore TTL deletion is asynchronous, so these values are deletion targets rather than a guarantee that removal occurs at an exact second. Author withdrawal deletes private feedback immediately through an authenticated transaction. Configure TTL on `expiresAt` for the `messages` collection group and the `communityReports`, `communityFeedback`, `communityFeedbackStatus`, `communityModerationAudit`, `communityFeedbackAudit`, `communityActors`, `communityPresence`, and `communityRateLimits` collections before activation.

## Presence and traffic

The visible drawer reports only an approximate count of community identities active in RMT Live during the last few minutes. Opening the drawer creates or reuses an authenticated Firebase identity and sends a low-frequency, server-mediated heartbeat. The server stores a keyed, short-lived record without the raw Firebase identifier and returns a Firestore aggregate count rather than downloading presence documents.

Browser clients cannot list, read, create, or alter presence records. Expired records are excluded from every count even before storage cleanup occurs. Configure Firestore TTL cleanup on the `expiresAt` field for both the `communityPresence` and `communityRateLimits` collections before public activation. The count is intentionally not an exact roster, site-wide visitor count, wallet count, or trading-activity metric. A future named roster must be explicit opt-in for protected profiles; guest identities remain aggregate-only.

Presence heartbeats occur only while the RMT Live panel is open, currently once every 90 seconds with a four-minute activity window. This is suitable for a small rollout. Before a broad campaign, compare the measured write rate against Firebase capacity and move presence to infrastructure designed for sustained concurrent sessions if needed.

Traffic measurements should include active sessions, concurrent sessions, messages per minute, moderation events, database reads/writes, stored bytes, and error rates. Service upgrades should be triggered by measured capacity or reliability needs, not by an automatic spending promise.

## Activation blockers

Run the repository-only gate after every community change:

```sh
pnpm check:community-readiness -- --repository-only
```

Run the read-only live index and retention check against the intended Firebase
project before activation:

```sh
pnpm check:community-readiness -- --project <firebase-project-id>
```

The live check prints configuration names and collection groups only. It never
prints credential values and never deploys, enables, deletes, or mutates
Firebase resources. A blocked result is an activation stop, not a warning.
Anonymous Authentication, the exact active Firestore ruleset, and the
controlled abuse/accessibility rehearsal remain explicit operator
verifications because the Firebase CLI cannot prove them from the checked-in
files alone.

1. Enable Firebase Anonymous Authentication.
2. Add a random production-only `COMMUNITY_IDENTITY_SECRET` of at least 32 characters.
3. Deploy the reviewed Firestore rules and composite index.
4. Deploy and load-test the prepared distributed limiter; add an edge limiter before a large public campaign.
5. Configure TTL cleanup for private presence records.
6. Deploy and verify the prepared retention fields, TTL policies, moderation terms, and versioned community acknowledgement.
7. Run mobile and desktop accessibility and abuse testing.
