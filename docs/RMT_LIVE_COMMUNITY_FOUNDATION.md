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

Firestore TTL deletion is asynchronous, so these values are deletion targets rather than a guarantee that removal occurs at an exact second. Author withdrawal deletes private feedback immediately through an authenticated transaction. Managed Firestore TTL requires billing on the current Firebase project, so RMT does not enable it while operating on the no-cost plan. The server instead uses a private distributed six-hour lease and bounded deletion batches for expired `messages`, `communityReports`, `communityFeedback`, `communityFeedbackStatus`, `communityModerationAudit`, `communityFeedbackAudit`, `communityActors`, `communityPresence`, and `communityRateLimits` records. This application cleanup must be monitored and managed TTL should replace it if measured traffic justifies enabling billing.

## Presence and traffic

The visible drawer reports only an approximate count of community identities active in RMT Live during the last few minutes. Opening the drawer creates or reuses an authenticated Firebase identity and sends a low-frequency, server-mediated heartbeat. The server stores a keyed, short-lived record without the raw Firebase identifier and returns a Firestore aggregate count rather than downloading presence documents.

Browser clients cannot list, read, create, or alter presence records. Expired records are excluded from every count even before storage cleanup occurs. The bounded server retention sweep removes expired presence and rate-limit records while billing remains disabled. The count is intentionally not an exact roster, site-wide visitor count, wallet count, or trading-activity metric. A future named roster must be explicit opt-in for protected profiles; guest identities remain aggregate-only.

Presence heartbeats occur only while the RMT Live panel is open, currently once every 90 seconds with a four-minute activity window. This is suitable for a small rollout. Before a broad campaign, compare the measured write rate against Firebase capacity and move presence to infrastructure designed for sustained concurrent sessions if needed.

Traffic measurements should include active sessions, concurrent sessions, messages per minute, moderation events, database reads/writes, stored bytes, and error rates. Service upgrades should be triggered by measured capacity or reliability needs, not by an automatic spending promise.

## Activation blockers

### Production readiness record — 2026-07-29

- Reviewed Firestore rules compiled and were released to the
  `robinhood-meme-terminal` project.
- The reports, presence, visible-message, and message-retention indexes were
  deployed and confirmed through a read-only live query.
- Firebase Anonymous Authentication is enabled.
- Firebase automatic cleanup for anonymous accounts older than 30 days is
  enabled.
- Firebase billing remains disabled. Managed TTL was not enabled and no paid
  upgrade was accepted.
- Vercel contains all six browser-side Firebase configuration names for
  production and preview.
- A dedicated `rmt-live-server` service account was created with only Cloud
  Datastore User and Firebase Authentication Viewer roles. It does not have an
  Editor, Owner, Firebase Admin, or IAM administration role.
- `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`,
  `FIREBASE_ADMIN_PRIVATE_KEY`, and a newly generated
  `COMMUNITY_IDENTITY_SECRET` are stored as sensitive Vercel variables scoped
  to production and preview. No credential value was committed, printed in
  logs, or retained in the local checkout; the downloaded key file was removed
  after the encrypted Vercel transfer.
- An earlier protected preview of this extracted RMT Live code exposed a Node
  module compatibility failure between
  `firebase-admin` 14.2.0, `jwks-rsa` 4.1.0, and ESM-only `jose` 6.2.3 in the
  Vercel function runtime. RMT pinned `firebase-admin` 13.6.0, which resolves
  to `jwks-rsa` 3.2.2 and `jose` 4.15.9 for the Admin SDK path.
- The repaired preview completed anonymous Firebase sign-in, server-side ID
  token verification, a bounded Firestore presence write, and aggregate
  presence read. The interface returned approximately one online identity.
  No public chat message or feedback record was created during verification.
- The preview site returned `200`; an unauthenticated request to
  `/api/community/presence` returned `401`. All GitHub checks passed, including
  web, contracts, three indexer suites, secret scanning, and Vercel.
- The bounded application retention sweep is implemented and exercised by the
  successful authenticated presence path, but it remains preview evidence
  until a separately authorized production release is deployed and monitored.
- The current public site returns `404` for `/api/community/presence`, proving
  the community server routes are not live yet. Existing terminal production
  remained unchanged during the credential transfer and preview rehearsal.
- The current PR head passed every required GitHub check: web, contracts, all
  three indexer suites, secret scanning, and Vercel.
- A controlled `390 × 844` viewport rehearsal confirmed that RMT Live switches
  to its mobile navigation and fits the viewport without widening the page.
- The protected preview completed the private feedback create, limited public
  status, and same-author withdrawal lifecycle. Private feedback content and
  author state were removed while the bounded audit/status behavior remained
  intact.
- A clearly marked public rehearsal message was created, located by its exact
  body and identifier, permanently removed, and confirmed absent from the
  live room. No unrelated message was changed.
- A live self-report attempt was rejected with `You cannot report your own
  message.`, confirming that the server fails closed for that path.
- A live cooldown rehearsal accepted the first marked message and rejected the
  immediate second attempt with `Please wait a few seconds before posting
  again.` The accepted record was then permanently removed and both rehearsal
  bodies were confirmed absent from public message articles.
- The message restriction, cooldown, guest quota, member quota, exact expiry,
  and hourly-window reset decisions are isolated in a deterministic policy and
  covered at their boundary conditions. The live drawer exposes its controlled
  region and report controls to assistive technology, labels its message
  composer and status updates, closes with Escape, and returns focus to its
  launcher.
- The controlled preview hostname was authorized as a Firebase caller for the
  rehearsal. RMT uses the permanent registered authentication helper rather
  than turning temporary deployment hostnames into OAuth callbacks. Google
  profile sign-in now uses the user-initiated popup flow, while passwordless
  email remains the fallback for browsers that block provider windows.
- A second isolated identity, `Guest-2110`, reported `Guest-3D1F`'s visible
  `hello` message as `spam`. The report appeared only in the private
  administrator queue, proving the true cross-identity report path rather than
  substituting the self-report rejection test.
- The verified `launchrmt@gmail.com` administrator dismissed that controlled
  report with the private note `Controlled cross-identity preview rehearsal;
  no policy violation.` Firestore confirmed the report is `dismissed`, the
  private moderation audit references the exact report and message, and the
  restriction duration is zero. The original message remains `visible`, and
  the author's private actor record has no `bannedUntil` field. No message was
  hidden and neither identity was restricted.
- The preview may display a WalletConnect/Reown origin-allowlist warning. That
  preview-only wallet configuration warning did not affect the community
  identity, presence, feedback, message, or cooldown paths tested above.

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

1. Complete controlled desktop accessibility, malformed-payload, and live
   quota rehearsals against the protected preview. Mobile layout, cooldown,
   self-report rejection, feedback withdrawal, cross-identity reporting, and
   administrator dismissal now have current preview evidence.
2. Review preview runtime logs and Firebase usage after the controlled
   rehearsal window.
3. Keep the focused RMT Live rollout PR unmerged until its fresh preview
   evidence is accepted and production is separately authorized.
4. After separate production approval, merge and verify the public route,
   anonymous identity, presence, moderation, and bounded retention paths.
5. Add a reputable edge limiter before a large public campaign or when
   measured rejected traffic becomes material.
6. Replace application retention with managed Firestore TTL only if measured
   traffic justifies enabling billing.
