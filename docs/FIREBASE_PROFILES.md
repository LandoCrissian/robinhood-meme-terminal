# Firebase profile setup

RMT supports two profile modes:

- **Local mode** is the automatic fallback. Profile preferences and watchlists stay in the current browser and the trading product remains fully usable.
- **Cloud mode** uses Firebase Authentication and Cloud Firestore. A signed-in user owns one private `users/{uid}` document containing profile preferences and up to 50 watched tokens.

Wallet connection and profile authentication are deliberately separate. Firebase never receives a seed phrase, private key, wallet signature, trade approval, or custody authority.

## Project setup

1. Create or choose the Firebase project in the Firebase console and register a Web app.
2. In Authentication, enable the Google provider. Add the production RMT domain and the Vercel preview domain only when previews need authentication testing.
3. Create a Cloud Firestore database in production mode.
4. Deploy the committed rules with `firebase deploy --only firestore:rules` after reviewing the selected Firebase project.
5. Copy the registered web app values into the matching `NEXT_PUBLIC_FIREBASE_*` deployment variables documented in `apps/web/.env.example`.
6. Redeploy RMT, sign in on `/profile`, save a profile, and verify that only `users/{authenticated uid}` is readable and writable.

The Firebase web API key is project identification, not a database authorization secret. Still restrict the key to the required Firebase APIs and approved RMT web origins in Google Cloud. Firestore authorization is enforced by `firestore.rules` and must never be replaced with permissive test rules.

## Stored data

- display name, handle, short desk note
- operating mode and information-density preference
- watched-token metadata required to reconstruct the watchlist
- Google account email for account identification
- server-generated update timestamp

No portfolio balances are stored. Portfolio data continues to be read from the connected public wallet address onchain.

## Account behavior

On first sign-in, RMT merges the current local watchlist with the cloud watchlist by token address and keeps the newest copy. Later watchlist edits are debounced and written to the signed-in user's document. Signing out returns RMT to local mode without deleting local preferences.
