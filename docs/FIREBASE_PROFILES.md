# Firebase profile setup

RMT supports two profile modes:

- **Local mode** is the automatic fallback. Profile preferences and watchlists stay in the current browser, and the trading product remains fully usable.
- **Cloud mode** uses Firebase Authentication and Cloud Firestore. A signed-in user owns one private profile workspace and receives live profile/watchlist updates across signed-in devices.

Wallet connection and profile authentication are deliberately separate. Firebase never receives a seed phrase, private key, wallet signature, trade approval, portfolio balance, or custody authority. Firebase remains an offchain convenience layer and is not a protocol dependency.

## Data model

- `users/{uid}` stores schema version 1, the normalized profile, independent profile/watchlist update versions, the watchlist count, the last identity-change timestamp, and a server timestamp.
- `users/{uid}/watchlist/00` through `49` store at most 50 validated token records. Fixed slot IDs make the maximum enforceable in Firestore rules, while per-record rules validate addresses, text lengths, image schemes, launch IDs, and timestamps.
- `creatorApplications/{uid}` stores the private, review-gated project application. Only the applicant and the RMT administrator can read it.
- `projects/{slug}` stores the approved public page. The assigned creator may update bounded presentation fields but cannot change the token address, enabled modules, publication state, or ownership.
- `projectAssignments/{slug}` privately maps an approved page to its verified Firebase owner and permitted modules.
- `projects/{slug}/gameUpdates/{updateId}` stores bounded creator-authored milestones, playtests and releases for approved game pages. Visitors may read updates only while the parent page is live; only the verified assigned creator may write them.
- `users/{uid}/projectFollows/{slug}` privately records the approved pages a user follows. Follower identities and lists are never public.
- `projectStats/{slug}` exposes only the aggregate follower count. Firestore rules require the private follow and aggregate count to change together in one atomic write, preventing direct count edits.
- `users/{uid}/referralProfile/current` privately records one permanent invite code for the owner. `referralCodes/{code}` stores the private owner ID and aggregate verified activation count; only the owner may read it.
- `users/{uid}/referralClaim/current` privately records the single code an account activated. Rules prevent self-referrals and require the claim and aggregate `+1` to occur in one atomic write.
- Google account email and photo are read from the active Firebase Authentication session for the signed-in UI. RMT does not duplicate either value in Firestore.

Local profile and watchlist records carry independent update versions. On sign-in, the latest profile and latest complete watchlist win separately. Newer deletions therefore stay deleted instead of being reintroduced by an older device. Firestore listeners deliver later changes to other open, signed-in RMT sessions.

Display name, handle, and desk note use a deliberate identity lifecycle. The user reviews those fields before the first save, may make corrections for 10 minutes, and then waits 24 hours from the latest identity change before editing them again. Firestore rules enforce the same window across signed-in devices using server time. Operating mode and information density are terminal preferences and remain editable during the identity protection period. Local-only profiles apply the same experience in that browser, but browser storage is not an authentication boundary.

Invite links use `/r/RMT-XXXXXXXX` and open a dedicated consent page. Only after a visitor explicitly accepts the invite does RMT retain a valid pending code in that browser, for at most 30 days. An activation is recorded only after the referred user has verified sign-in and saved a protected profile. Codes are randomly generated, permanent, non-editable, and restricted to one claim per account. The first release measures verified profile activations only: it does not count clicks, create financial rewards, or connect an X account. Sharing on X uses a public Web Intent and does not require or expose X API credentials.

## Safe activation order

1. Create or choose the Firebase project and register a Web app.
2. Add only the exact RMT domains that need sign-in, including the canonical production domain. Do not authorize wildcard or disposable preview domains. Google sign-in, the OAuth display name, and the public support email are committed in `firebase.json` and deployed in step 4.
3. Create Cloud Firestore in production mode. Never start with permissive test rules.
4. From a reviewed local checkout, authenticate the Firebase CLI and deploy the committed Authentication provider configuration and rules:

   ```bash
   pnpm exec firebase deploy --only auth,firestore:rules --project <firebase-project-id>
   ```

5. Run the rules emulator suite and the web checks:

   ```bash
   pnpm test:firebase-rules
   pnpm --filter web test:profile
   pnpm typecheck
   pnpm build
   ```

6. Copy the registered Web app values into the matching `NEXT_PUBLIC_FIREBASE_*` deployment variables documented in `apps/web/.env.example`. Set the variables only after the production rules are deployed.
7. Redeploy RMT. On `/profile`, sign in, review and save an identity, confirm the correction window appears on a second device, and verify preferences remain editable. Add and remove a watched token, then confirm the same state appears on the second device. Also confirm signed-out and different-user reads fail.

## Branded authentication domain

Production sets `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=www.rmtlaunch.fun`. The Vercel rewrite in `apps/web/vercel.json` transparently proxies only `/__/auth/*` to the project's Firebase Hosting origin, so Google can return through `https://www.rmtlaunch.fun/__/auth/handler` while the browser remains on the RMT domain.

Keep `www.rmtlaunch.fun` in Firebase Authentication's authorized domains and keep the exact handler URL registered on the Firebase-generated Google OAuth client. Do not use a redirect response in place of the rewrite: the auth helper must be reverse-proxied without changing the browser URL. The original `robinhood-meme-terminal.firebaseapp.com` domain remains the upstream and rollback path.

Google Search Console ownership for `https://www.rmtlaunch.fun` is maintained by the `verification.google` metadata entry in `apps/web/app/layout.tsx`. Keep that tag in the deployed homepage so the OAuth branding verification remains valid.

The Firebase Web API key identifies the project; it is not the Firestore authorization boundary. Restrict the key to the required Firebase APIs and approved RMT origins in Google Cloud. Authorization is enforced by `firestore.rules`, which requires a verified signed-in owner and denies every unrelated collection.

## App Check

RMT can optionally initialize Firebase App Check with a reCAPTCHA Enterprise site key through `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`. Treat this as defense in depth, not a replacement for Authentication or Firestore rules. Review reCAPTCHA Enterprise quotas and pricing, observe App Check metrics before enforcement, and never place a debug token in a public build.

The browser uses Firestore's memory cache rather than persistent IndexedDB caching. RMT already keeps a deliberately small local profile fallback, and avoiding an additional persistent Firestore cache reduces leftover account data on shared devices.

## Operational behavior

- Google sign-in uses a user-initiated popup on desktop and mobile. This avoids the cross-origin storage requirements of redirect sign-in on modern browsers.
- If Firebase is absent or temporarily unavailable, profile edits remain saved locally and trading remains operational.
- A failed cloud write displays a retry action. Writes are serialized, schema-versioned, and protected from older profile/watchlist versions overwriting newer ones.
- Deploy rules before enabling the client configuration. Rolling the variables back disables new Firebase initialization without affecting wallets, launches, market data, or trading.
