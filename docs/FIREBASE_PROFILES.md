# Firebase profile setup

RMT supports two profile modes:

- **Local mode** is the automatic fallback. Profile preferences and watchlists stay in the current browser, and the trading product remains fully usable.
- **Cloud mode** uses Firebase Authentication and Cloud Firestore. A signed-in user owns one private profile workspace and receives live profile/watchlist updates across signed-in devices.

Wallet connection and profile authentication are deliberately separate. Firebase never receives a seed phrase, private key, wallet signature, trade approval, portfolio balance, or custody authority. Firebase remains an offchain convenience layer and is not a protocol dependency.

## Data model

- `users/{uid}` stores schema version 1, the normalized profile, independent profile/watchlist update versions, the watchlist count, and a server timestamp.
- `users/{uid}/watchlist/00` through `49` store at most 50 validated token records. Fixed slot IDs make the maximum enforceable in Firestore rules, while per-record rules validate addresses, text lengths, image schemes, launch IDs, and timestamps.
- Google account email and photo are read from the active Firebase Authentication session for the signed-in UI. RMT does not duplicate either value in Firestore.

Local profile and watchlist records carry independent update versions. On sign-in, the latest profile and latest complete watchlist win separately. Newer deletions therefore stay deleted instead of being reintroduced by an older device. Firestore listeners deliver later changes to other open, signed-in RMT sessions.

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
7. Redeploy RMT. On `/profile`, sign in, save a profile, add and remove a watched token, then confirm the same state appears on a second device. Also confirm signed-out and different-user reads fail.

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
