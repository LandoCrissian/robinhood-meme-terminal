# RMT account and private profile setup

**Status: PAUSED product / preserved security and data reference.** Profile onboarding, editing, referrals and cloud-profile synchronization are not part of the active terminal. The exact-wallet identity boundary remains active security infrastructure; existing records and Firestore protections are preserved. See [`ARCHITECTURE_FREEZE.md`](ARCHITECTURE_FREEZE.md).

RMT has one visible account layer:

- **Local mode** is the automatic fallback. Profile preferences and watchlists stay in the current browser, and trading remains usable without an account.
- **RMT account mode** uses Privy for email-code, Google, passkey, and existing-wallet sign-in. RMT verifies Privy's signed identity on the server and creates a short-lived Firebase custom session for private Firestore data.

Firebase is not a second user-facing login. The browser never supplies a trusted email, UID, admin role, or database claim. Selecting a different trading wallet does not change the owner of the RMT profile.

The first method a visitor uses opens the Privy identity. Additional email, Google, passkey, and external-wallet methods must be linked from the signed-in Profile page rather than used as fresh sign-ins. This keeps recovery methods, the private RMT profile, administrator access, and the wallet workspace attached to the same Privy user.

Account sign-in does not authorize a trade or give RMT custody. RMT never receives a seed phrase, private key, wallet signature, approval, portfolio balance, or payment credential through the profile bridge.

## Identity bridge

1. Privy signs an identity token for the authenticated user.
2. The browser sends that token to the same-origin `/api/auth/firebase-session` endpoint.
3. The server verifies the token with Privy's official server library and configured public verification key.
4. RMT binds the verified Privy user ID to one Firebase UID and sets the private `privy_verified` and `rmt_privy_uid` claims.
5. If the Privy identity contains a verified email matching the existing RMT administrator account, the bridge adopts that Firebase user instead of creating a duplicate.
6. The browser receives a short-lived Firebase custom token and uses it only for Firestore access. Firestore rules require the server-issued Privy binding.

The binding is one way: an already-bound Firebase profile cannot be reassigned to a different Privy user through the browser. A wallet-only user may sync a profile, watchlist, referrals, and community identity. Creator applications require a verified contact email; RMT administrator access additionally requires the exact verified administrator email.

## Data model

- `users/{uid}` stores schema version 1, the normalized profile, independent profile/watchlist update versions, the watchlist count, the last identity-change timestamp, and a server timestamp.
- `users/{uid}/watchlist/00` through `49` store at most 50 validated token records.
- `creatorApplications/{uid}` stores the private, review-gated project application.
- `projects/{slug}` stores the approved public page.
- `projectAssignments/{slug}` privately maps an approved page to its verified owner and permitted modules.
- `projects/{slug}/gameUpdates/{updateId}` stores bounded creator-authored project updates.
- `users/{uid}/projectFollows/{slug}` privately records followed projects; `projectStats/{slug}` exposes only an aggregate follower count.
- `users/{uid}/referralProfile/current`, `referralCodes/{code}`, and `users/{uid}/referralClaim/current` implement bounded, private referral attribution.

The verified email and optional provider photo come from the authenticated account session and are not copied into the profile document.

Local and cloud profile/watchlist records carry independent update versions. The newest complete version wins on sign-in, so an older device cannot silently restore deleted items. Display name, handle, and desk note have a 10-minute correction period followed by a 24-hour edit protection period enforced in both the interface and Firestore rules.

## Required configuration

### Privy

1. Configure email, Google, passkey, and wallet login methods as desired in the Privy Dashboard. Google is optional; email code remains available to non-Gmail addresses.
2. Under **User management → Authentication → Advanced**, enable **Return user data in an identity token**.
3. Set `NEXT_PUBLIC_PRIVY_APP_ID` to the public app ID.
4. Set the server-only `PRIVY_VERIFICATION_KEY` to the dashboard's identity-token public verification key. Preserve line breaks as escaped `\n` characters in hosted environments.
5. Authorize only exact RMT production and controlled preview origins. Do not use wildcard preview trust.

### Firebase

1. Create or choose the Firebase project, register a Web app, and create Cloud Firestore in production mode.
2. Set the documented `NEXT_PUBLIC_FIREBASE_*` Web app values. These values identify the Firebase project; they do not authorize database access.
3. Configure the server-only Firebase Admin service-account variables. Keep the existing Cloud Datastore User and Firebase Authentication Viewer roles for the documented RMT Live work. Add a custom project role containing only `firebaseauth.users.get`, `firebaseauth.users.create`, and `firebaseauth.users.update` for the account bridge. The update permission covers the verified-email migration and custom access claims. Do not grant Owner, Editor, Firebase Admin, Firebase Authentication Admin, config-management, delete-user, or IAM-management access. The current private-key credential mints Firebase custom tokens locally and does not require a broader Firebase role. Never expose the service-account key to browser code or logs.
4. Deploy the reviewed Firestore rules before enabling the browser configuration.
5. Direct Firebase Google and email-link sign-in are not used by RMT and must not be advertised as a separate account path. The former Vercel `/__/auth/*` proxy and provider configuration are intentionally removed from the repository. After the protected migration proves the administrator profile recovery, disable those two legacy providers in the live Firebase project; keep Anonymous Authentication for RMT Live guests.

## Verification gate

From a reviewed checkout, run:

```bash
pnpm test:firebase-rules
pnpm --filter web test:profile
pnpm --filter web test:community
pnpm --filter web test:trade-speed
pnpm typecheck
pnpm build
```

Then validate a protected preview on mobile and desktop:

1. Sign in with the verified `launchrmt@gmail.com` Privy identity and confirm the existing profile and RMT Admin control return without a duplicate wallet or duplicate Firebase user.
2. Sign out from Profile and from the wallet control; confirm the Privy session, Firebase session, active Wagmi connection, and visible account state clear.
3. While still signed in, link an email code and an existing wallet from Profile. Sign out, then confirm each linked method reopens the same Privy-owned workspace. Do not test this by creating separate unlinked sign-ins.
4. Switch between the embedded RMT Wallet and an external wallet. Confirm the cloud profile does not change owners.
5. Save a profile and watchlist change on one device and confirm it appears on the other.
6. Confirm signed-out users, unbound Firebase users, and different Privy users cannot read or write the profile.
7. Confirm RMT Live, referrals, creator review, and the private admin dashboard still enforce their existing access rules.

## Operational behavior

- If Privy, Firebase, or the bridge endpoint is unavailable, local profile mode and non-custodial trading remain available.
- A failed cloud write displays a retry action. Writes remain serialized and versioned.
- Signing out ends the RMT and Firebase cloud sessions. Browser-local preferences remain until the user clears site data.
- Firebase App Check may be enabled as defense in depth after observing metrics. It does not replace identity verification or Firestore rules.
- The browser uses Firestore memory cache rather than persistent IndexedDB caching to reduce leftover cloud data on shared devices.
- Never enable the bridge without both server verification and the Privy-bound Firestore rules.
