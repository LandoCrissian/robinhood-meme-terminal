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
- Direct messages, media uploads, link previews, wallet tips, trading calls, and ranking influence are not part of this release.
- Community engagement does not alter Runner ranking, token risk, or verification.

The in-memory IP limiter is defense in depth, not a distributed production limiter. Sustained public traffic requires a durable edge limiter and moderation queue before broader rollout.

## Presence and traffic

The visible drawer deliberately does not invent an online count. Aggregate presence requires a private Realtime Database presence tree plus trusted aggregation so guest identifiers never become public. The UI will display only an approximate total and an opt-in roster of profiled members after that trusted aggregation exists.

Traffic measurements should include active sessions, concurrent sessions, messages per minute, moderation events, database reads/writes, stored bytes, and error rates. Service upgrades should be triggered by measured capacity or reliability needs, not by an automatic spending promise.

## Activation blockers

1. Enable Firebase Anonymous Authentication.
2. Add a random production-only `COMMUNITY_IDENTITY_SECRET` of at least 32 characters.
3. Deploy the reviewed Firestore rules and composite index.
4. Build admin report, hide, restriction, and audit controls.
5. Add durable distributed rate limiting before an open public campaign.
6. Add private presence storage and trusted aggregate counts.
7. Add retention, deletion, moderation, and acceptable-use terms.
8. Run mobile and desktop accessibility and abuse testing.
