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
- Direct messages, media uploads, link previews, wallet tips, trading calls, and ranking influence are not part of this release.
- Community engagement does not alter Runner ranking, token risk, or verification.

The in-memory IP limiter is defense in depth, not a distributed production limiter. Sustained public traffic requires a durable edge limiter and moderation queue before broader rollout.

## Presence and traffic

The visible drawer reports only an approximate count of community identities active in RMT Live during the last few minutes. Opening the drawer creates or reuses an authenticated Firebase identity and sends a low-frequency, server-mediated heartbeat. The server stores a keyed, short-lived record without the raw Firebase identifier and returns a Firestore aggregate count rather than downloading presence documents.

Browser clients cannot list, read, create, or alter presence records. Expired records are excluded from every count even before storage cleanup occurs. Configure Firestore TTL cleanup on the `expiresAt` field for the `communityPresence` collection before public activation. The count is intentionally not an exact roster, site-wide visitor count, wallet count, or trading-activity metric. A future named roster must be explicit opt-in for protected profiles; guest identities remain aggregate-only.

Presence heartbeats occur only while the RMT Live panel is open, currently once every 90 seconds with a four-minute activity window. This is suitable for a small rollout. Before a broad campaign, compare the measured write rate against Firebase capacity and move presence to infrastructure designed for sustained concurrent sessions if needed.

Traffic measurements should include active sessions, concurrent sessions, messages per minute, moderation events, database reads/writes, stored bytes, and error rates. Service upgrades should be triggered by measured capacity or reliability needs, not by an automatic spending promise.

## Activation blockers

1. Enable Firebase Anonymous Authentication.
2. Add a random production-only `COMMUNITY_IDENTITY_SECRET` of at least 32 characters.
3. Deploy the reviewed Firestore rules and composite index.
4. Add durable distributed rate limiting before an open public campaign.
5. Configure TTL cleanup for private presence records.
6. Add retention, deletion, moderation, and acceptable-use terms.
7. Run mobile and desktop accessibility and abuse testing.
