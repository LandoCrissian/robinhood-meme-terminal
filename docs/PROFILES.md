# Launchpad profiles

Profiles are an optional account workspace, separate from transaction authority. This branch prepares local Auth, Firestore and Storage integration. Production profile activation and production data changes are not authorized by these files.

## Existing Firebase identity and data

Read-only authenticated Firebase CLI metadata identified the existing **robinhood-meme-terminal** project and **RMT Web** app. Its native default Firestore database is in `nam5`, Standard edition with the free-tier flag. Point-in-time recovery and deletion protection are disabled; neither setting was changed. [Inactive reuse target](../config/firebase/existing-project.json) contains public identifiers only. No production user documents, credentials, tokens or API keys were exported.

Before cleanup (`ffa0eb4b^`), the account bridge verified Privy identity tokens and used `rmt_privy_` plus the SHA-256 of the Privy ID as the Firebase UID. A verified email could recover an existing Firebase account, subject to an immutable `rmt_privy_uid` binding. `users/{uid}` stored schema-1 profile fields (`displayName`, `handle`, `bio`, terminal preferences), update timestamps and watchlist metadata. Old rules required server-issued `privy_verified` and `rmt_privy_uid` claims. No durable wallet-to-UID mapping or avatar-storage rule was found in that tracked implementation.

A wallet signature therefore cannot establish ownership of an old email/Privy account. The new integration must preserve those records and require authenticated linking before adopting an existing identity. Do not merge by nickname, submitted email or an unverified wallet field. Legacy community, referral, marketplace and terminal code is not restored.

Actual collection-name metadata confirms `users` and the historical community/referral namespaces still exist; document values were not queried. The live Firestore rules were last updated August 2, 2026, have SHA-256 `11b3e1c33a3b542c6c5f57c3ccc6e763f62a5dbcb5da374c5e0f503f9b0a195d` (34,960 bytes), require Privy binding for users, and differ from the pre-cleanup tracked file. There is no live launch-profile namespace rule or Storage rule release.

Cloud Billing read-only metadata reports billing **disabled**. A direct metadata GET for the SDK-configured bucket returns **HTTP 404: bucket does not exist**; a configured bucket name does not prove storage availability. Firebase's [current Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024) require Blaze for Cloud Storage, including new default buckets. Bucket-based avatars are therefore unavailable under the current no-upgrade boundary. The branch instead prepares bounded, server-only Firestore avatar records; enabling a Storage bucket is not a prerequisite for that path. No billing account, bucket or paid plan was enabled. Do not represent emulator uploads as a working hosted feature.

## Local verification

Use Node 22, the pinned package manager and Java 21 or newer. The official Emulator Suite runs Auth `127.0.0.1:9099`, Firestore `127.0.0.1:8080` and Storage `127.0.0.1:9199` under **demo-rmt-launch-profiles**. This demo identifier does not provision a Firebase project. No hosted service or external credentials are needed.

```powershell
pnpm install --frozen-lockfile
# Optional: local JRE directory when java is not on PATH.
$env:RMT_PROFILE_JAVA_HOME = '<local Java 21 home>'
node scripts/profiles/run-emulator-tests.mjs
```

The harness fixes the demo project, validates loopback-only emulator bindings, removes production credential/configuration environment variables and starts no cloud resources. `--command '<test command>'` runs an additional server/browser suite under the same emulators. The host verification used a private portable Temurin JRE 21.0.13+9; its official archive SHA-256 was `2332c0b4cff6bed722da3567c91d5e47568bcba863fa4945d0a8d6fc76158628`. No global Java installation was changed.

The profile-only rules permit an individual public-card read and the authenticated UID's own private-preferences read. Collection enumeration and browser writes are denied. Wallet bindings, username locks, nonces, sessions, budgets, avatar bytes and legacy records are server-only. Direct Storage reads and writes are denied; the server must decode, bound and re-encode avatars and serve them through its bounded profile API. Admin SDKs bypass rules, so server validation and authorization tests are separate requirements.

The actual official-emulator rules suite passed four tests: public-document access without enumeration/mutation, private UID isolation, internal/legacy namespace denial, and Storage upload/read/metadata/delete denial for signed-out, matching and other accounts. Direct-upload probes include SVG and oversized bytes. This is rules evidence only; it does not substitute for the server's nonce, session, username race, sanitized-image and browser acceptance suites.

**These are emulator rules, not a drop-in replacement for the current live project's rules.** Before any separately approved activation, inspect the currently published rules and merge only reviewed new namespaces. Preserve existing users and their protection, verify authenticated legacy-link recovery, session-cookie/revocation behavior, authorized domains, service-account privileges and Storage availability/cost under the existing plan. Do not deploy these files to discover whether production permissions work.

The [Firebase emulator guide](https://firebase.google.com/docs/emulator-suite/install_and_configure) and [Security Rules test guide](https://firebase.google.com/docs/rules/unit-tests) describe the official tooling. Emulator results do not establish physical-iPhone acceptance or production provider availability.
