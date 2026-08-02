# RMT Phone Alerts

RMT phone alerts are a staged extension of the private watchlist-alert system.
They are not active in production. The profile may let an authenticated user
link and verify a phone through Privy, but linking a phone does not create SMS
consent and does not cause RMT to send a message.

## Intended user flow

1. The user signs in to the existing RMT account.
2. The user links and verifies a phone through Privy.
3. Once delivery is operational, the user separately accepts the current RMT
   phone-alert disclosure and selects a bounded daily message limit.
4. Only watchlist rules that user explicitly created may produce a text.
5. Every alert links back to the exact RMT market workspace and includes STOP
   instructions. An alert never signs, places, changes, or closes a trade.
6. The user can disable delivery in Profile or reply STOP.

## Privacy and storage

- Privy performs phone verification.
- RMT never stores the clear phone in browser-readable Firebase data.
- When the user enables delivery, the server stores an HMAC lookup key and an
  AES-256-GCM encrypted delivery number in a server-private preference record.
- The encryption key and HMAC secret are different server-only secrets.
- Disabling alerts deletes the encrypted number and lookup key from the active
  preference document while preserving minimal consent/revocation evidence.
- Logs must never contain the phone, encrypted phone, alert body, authorization
  token, provider credential, or provider response body.

## Compiled release lock

`SMS_BACKGROUND_DELIVERY_IMPLEMENTED` is intentionally `false`. Hosted
environment variables cannot bypass it. This remains locked until all of the
following are implemented and reviewed in one release:

- durable evaluator code now reads only the server-verified Firebase owner of
  each preference, uses a short Firestore lease, and processes at most 25
  preferences per invocation;
- transition and duplicate suppression now survive process restarts. The first
  observation arms a rule without sending; only a later clear-to-matched edge
  can reserve a delivery;
- the provider webhook now validates Twilio's signature against the exact
  canonical HTTPS URL, checks the Account and Messaging Service identities,
  and immediately removes delivery data for a signed `STOP`. `START` never
  silently recreates RMT consent and `HELP` does not change it;
- US A2P 10DLC registration and required disclosures;
- per-user daily caps and a global hard message-count circuit breaker are
  implemented. A configured cent budget is recorded for operations, but it is
  not misrepresented as an exact pre-send carrier-cost calculation;
- provider acceptance receipts and an at-most-once failure record are
  implemented. Unknown or failed sends are never automatically retried;
- delivery-status callbacks, dead-letter monitoring and operating alerts;
- staging tests with a provider test number and no production recipients;
- an explicit production release approval.

The source-level lock remains `false` until the remaining registration,
monitoring and staging items are complete. No hosted setting can turn this code
into a billable sender today.

## Evaluator and provider endpoints

- `POST /api/internal/alerts/sms-evaluate` accepts only a server-held bearer
  token. It loads the current RMT market snapshot once, deduplicates sell-tape
  reads, enforces per-user and global limits transactionally, and records no
  phone number or message body in delivery-attempt documents.
- `POST /api/alerts/sms-provider` accepts a bounded form body and a valid
  `X-Twilio-Signature`. Advanced Opt-Out is required on the Messaging Service.
  Twilio sends `OptOutType=STOP|START|HELP`; Twilio itself sends the keyword
  response, so RMT returns empty TwiML and never sends a second reply.
- All preference, evaluator, budget, lease and attempt collections are
  server-only. Firestore browser rules deny reads and writes, including to the
  authenticated owner.

The signature procedure and opt-out behavior follow Twilio's current primary
documentation:

- https://www.twilio.com/docs/usage/security#validating-requests
- https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out
- https://www.twilio.com/docs/messaging/guides/webhook-request

## Provider configuration

The dormant adapter targets a Twilio Messaging Service so carrier opt-out
handling can be centralized. Configuration is documented in
`apps/web/.env.example`. No dependency package is required; the adapter uses the
provider's HTTPS API, a short timeout, a one-segment message ceiling, and a
bounded response parser.

Provider fees, carrier fees, number rental, and registration charges may apply.
RMT must publish the actual limit and activation state instead of representing
SMS as a free or guaranteed channel.
