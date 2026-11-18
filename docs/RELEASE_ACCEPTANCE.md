# RMT Launch release acceptance

Design baseline: PR #665, `c61696dfbf4ee563ca68aa9d7577969abd068f5d`.
Task 070 changes are isolated in the draft stacked on #665. Current CI, exact
Linux artifact/source hashes and the read-only preview are recorded in that PR.
Passing website checks does not clear the retained [security findings](SECURITY.md).

## Source and deployment provenance

| PR | Exact reviewed head | Base branch |
| --- | --- | --- |
| #662 | `65d751eb68d1f01c8c6787e34796301d7483a738` | `rmt-launch-reserve-continuation` (#660) |
| #663 | `0cf0f23175b91ef65489abe395ae5750bb04cbaf` | `rmt-launch-protocol-deployment` (#662) |
| #664 | `da13144cb2f13318ef5e514bff3ec3ed3aa3aa8e` | `rmt-launch-profiles-refinement` (#663) |
| #665 | `c61696dfbf4ee563ca68aa9d7577969abd068f5d` | `rmt-launch-premium-polish` (#664) |

Each listed head is an ancestor of the next. They are open/unmerged. #662 also
depends on #660/#659 and earlier reviewed work; merging #665 into its feature
base does not publish `main`. At inspection `main` was
`ad75ea816c9782117d75b2fb078dba5ad6ce8fa6`; its common ancestor with the candidate
was `6d0b8103bdad95367445a38e5f5327458baa9ab2`. Do not merge the full stack
implicitly. Production is manually deployed; the Netlify site has no Git CD
repository binding.

Current production is `https://www.rmtlaunch.fun`, Netlify site
`ebdf8492-ff86-452f-b4cc-45d7865c8311`, deployment
`6af86be73747ac95bd6d15ea`. Its title identifies website source
`c455bfae617a547e1d86cbea90c0739cdd8da927` (PR #599); Netlify `commit_ref` is
null, so retain the source/artifact attestation rather than inventing a Git CD
binding. Its server ZIP SHA-256 is
`bdfdc1f4a2b1e6a0eb2865041c4c1205d350fc0a35118c8869ba574c46e5b36c`.
The site and execution-disabled config were HTTP 200 during Task 070.

Production history was independently HTTP 200, `ready`, `v6-indexed`, four
historical registrations at checkpoint `117145942` / `2026-11-18T04:52:24Z`.
This is an observation, not an ongoing freshness guarantee. Site-level Functions
environment enumeration was empty: PR #599 records a **deploy-scoped,
Functions-only** Railway secret. Preserve that existing configuration explicitly
for the next deployment; empty site metadata does not mean the working live
credential is absent. Never put the bearer in a client/public/build variable,
source, archive report or chat. Retain the verified stale snapshot fallback.

Task 070 also verified private credential recovery from the existing authorized
Railway CLI/service variable `RMT_INDEXER_READ_TOKEN`: unauthenticated history
returned 401 and the existing bearer returned 200, chain 4663, two backend V6
records and a fresh L2 checkpoint `117163402` at `2026-11-18T05:24:52Z`.
The bearer was not exported or printed, and no configuration changed. Thus no
new credential or owner password is needed for publication preparation; bind
the verified existing value to the new deployment's Functions scope and verify
continuity before an approved cutover. Do not assume the old deployment's
secret transfers automatically.

## Five separate approvals

| Stage | Acceptance before its own approval | Current boundary |
| --- | --- | --- |
| A. Website publication | Exact reviewed Linux artifact/source/tool hashes; approved domain; read-only routes; server-only Railway credential continuity; sufficient existing-plan credits; unchanged TLS/DNS; tested fallback and rollback source. | **Owner publication approval pending.** Normal production build is deliberately blocked in `netlify.toml`; do not remove that guard or publish without approval. |
| B. Firebase profiles | Existing project/app, least-privilege server credential, reviewed rules/IAM and cookie/origin checks first. Owner then separately approves authentication activation for physical SIWE/profile acceptance; successful device acceptance precedes declaring this stage accepted for general release. Preserve legacy records. | **Disabled.** Emulator success and passive packaged SDK import do not establish live cloud acceptance. |
| C. Factory publication | Fresh canonical schedule, current nonce/epoch/signers/runtimes and mature notice. Prepare an exact transaction for separate wallet approval. | **Pending real time and owner transaction approval.** Never recollect valid signatures or repeat Schedule. |
| D. Creation/trading/claims | Actual publication receipt, source verification, operational/indexing/recovery and L1-finality policy acceptances, applicable security disposition and exact reviewed execution adapters. | **Disabled.** An approved-account production creation adapter exists; general production trading/claims have no enabled adapter. Local 31337 execution is not a production switch. |
| E. Owner creates RMT | Eligible infrastructure and owner-creation acceptance; ordinary website review of the exact chain/account/factory, fixed supply, recipients, fee and recovery intent. | **Not initiated.** The owner creates RMT separately through the form; infrastructure deployment never mints it automatically. |

The next owner decision is: **Approve website-only publication of the verified
Linux artifact with the existing server-only Railway credential, leaving
Firebase and all transactions disabled.** The credential has already been
recovered and tested privately; no new password or address is needed. This does
not approve Firebase activation, governance execution, trading, claims or issuance.

### Remaining blockers, by impact

1. **Funded/public execution — no-go:** the strict compiler-closure security
   gate retains 22 high findings. Task 070 compared the CI report with the
   retained baseline: all 233 finding IDs match, added 0/removed 0. The separate
   full-tree gate also fails. No detector, finding disposition or release hold
   is waived. No paid audit is commissioned or made a new prerequisite here.
2. **Trading/claims — not implemented for production activation:** their working
   local adapters cannot be relabeled as approved 4663 execution. Require the
   separate bounded production adapters and acceptance before enabling them.
3. **Governance — pending real time and owner approval:** preserve the original
   schedule, signatures and actual execution window below.
4. **Firebase — activation/physical acceptance pending:** emulator coverage and
   packaged SDK checks pass; live credential/rule continuity and physical wallet
   acceptance are not established by them. Never deploy the emulator's blanket
   legacy-data deny rules over existing production rules without reviewing the
   combined policy and required consumers.
5. **Website — owner publication/credential continuity pending:** the Linux
   package is verified. Preserve the existing deploy-scoped Railway secret and
   current production until separately approved publication. Publishing a
   prebuilt reviewed artifact need not remove the automatic production-build
   guard; any later automated-build configuration change needs its own review.

The actual Linux source `4fdfbecdaaa5a846eae6441c224dc0be0de32e85` passed
[offline artifact CI](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44242661917).
Its server ZIP SHA-256 is
`f8f7c3cd291bf95d9e088e71f0e5c1c4a617613e3c72c349c8c551f58800032d`.
The isolated Netlify deployment `6afd354283aa615cb75fbc63` reports that exact
digest, `deploy-preview` context and no production publication. Native Sharp
encoding/decoding and passive Firebase Admin imports passed from the extracted
Linux ZIP. Previous Windows-built preview packages are not avatar-activation
evidence because they contain Windows-only native image binaries.

## Executed acceptance evidence

The [sanitized result manifest](evidence/rmt-task070/acceptance.json) binds the
Linux package, hosted browser results, emulator results and retained security
failures. Web unit/security tests passed 82/82; isolated Firebase passed four
rules tests, 13 Auth/Firestore test entries, one real Next HTTP test and both
Chromium/WebKit profile flows. Hosted quality passed eight engine/layout
combinations and 48 card/theme cases with zero wallet calls or page errors.
The public HTTP suite passed both engines, including 111 denied routes per
engine and seven disabled profile mutations. These are automated results,
not physical-device or independent-audit evidence.

The subsequent CI run
[`44244993122`](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44244993122)
caught a test-isolation defect: the server suite and browser suite reused the
same synthetic wallet. Four server avatar requests plus three browser requests
could cross the unchanged six-per-minute per-user budget. The preserved failure
screenshot reports rate limiting, not a successful upload. Browser fixtures now
use separate deterministic test-only identities for each engine and await actual
mutation responses/account binding/completion. No counter is reset, timeout
increased, rate limit relaxed or assertion removed. The original failure remains
part of the review evidence; later CI status is reported against its exact head.
The complete emulator regression passed again after this correction, including
both browser engines. Reproduce with `pnpm test:profiles` using the existing
isolated Java/Firebase test environment; the runner enforces loopback/emulator
bindings and never uses production profile credentials.

Reproduce the Linux package with the checked-in
[Linux preflight workflow](../.github/workflows/website-release-linux.yml).
Local focused checks use `node --test scripts/release/website-preflight.test.mjs`,
`python -B scripts/release/website-archive.test.py`,
`python -B scripts/release/website-bundle.test.py` and
`node --test scripts/production-readiness/check-governance-notice.test.mjs`.
The existing isolated Firebase workflow preserves its real Auth/Firestore
emulators and test-only signing keys; never point it at the production project.

Screenshots: [hosted wallet focus](evidence/rmt-task070/wallet-mobile.png) and
[isolated profile editor](evidence/rmt-task070/profile-emulator-mobile.png).

## Configuration and publication checklist

- Keep Node 22, pnpm 10.12.1, Next 15.5.29, reviewed Netlify CLI 27.14.2 and
  adapter 5.16.8. CI records the ephemeral build-tool lock and server/static/edge
  checksums. Publish a verified Linux-built package; a Windows-only Sharp
  binary cannot establish Linux avatar readiness. Later tool/version changes
  require another artifact check. Netlify's automatic adapter selection is not
  proof of the reviewed pin.
- All read-only website pages remain available: `/`, `/create-token`,
  `/my-launches`, `/wallet`, `/account/profile`, `/u/:username`,
  `/creator/:wallet`, legal routes and applicable token details. Invalid or
  unavailable registrations remain unavailable; no sample token is presented
  as a live project. Canonical history remains in the standalone read API.
- Website publication leaves `RMT_PROFILES_MODE`,
  `RMT_PROFILES_ACTIVATION_APPROVAL`, `RMT_CURVE_PRODUCTION_EXECUTION`,
  `RMT_CURVE_PRODUCTION_PREPARATION`, release attestations and fixture flags
  unset. No Anvil/emulator address belongs in a hosted runtime. `/api/launchpad/config`
  stays disabled; transactional/admin/test routes remain closed server-side.
- Railway's `RMT_LAUNCH_HISTORY_INDEXER_URL` and
  `RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN` remain server-only. Verify a fresh
  authenticated observation and outage/stale behavior before switching the
  domain. No new worker, database, provider, paid service or DNS change is needed.
- Firebase activation is separately pinned to project `robinhood-meme-terminal`,
  app `1:737255919447:web:8674f28ee2486a0b983812`, origin
  `https://www.rmtlaunch.fun`, chain 4663, `GCLOUD_PROJECT`,
  `RMT_FIREBASE_WEB_APP_ID`, `RMT_FIREBASE_WEB_API_KEY` and server-only
  `FIREBASE_SERVICE_ACCOUNT_JSON`. The exact existing approval mode is
  `approved-existing-firebase-v1`; its approval field is not owner consent by
  itself. No emulator variables, duplicate Firebase project or Privy SDK.
- Token creation additionally requires the exact named production profile,
  immutable manifest/hash and underlying acceptance records. Do not fill those
  records with arbitrary hashes or turn on public trading through fixture flags.

## Governance time and incident boundaries

The [fresh two-provider notice proof](evidence/rmt-task070/governance.json) binds
the scheduled transaction `0x96bd234e49d766c73c66f9787f26736040b4fc64d91ed2ae888eca3f4c8afb65`.
Eligibility is **November 19, 2026, 23:32:28 UTC / 4:32:28 PM MST**; expiry is
**November 26, 2026, 19:50:06 UTC / 12:50:06 PM MST**. The observed nonce is 0,
epoch 1 and publication is inactive. The probe observed block `117145570` at
`2026-11-18T04:51:55.219Z`; it is a bounded observation, not continuous monitoring.
L2 agreement is not Ethereum L1 finality.
Recheck at execution; no clock advancement or automatic action is authorized.

For a website regression, preserve current production and both artifact/source
identities. Prepare a **fix-forward source revert/rebuild** from the last
approved website tree, verify config/route/privacy checks, then obtain separate
publication approval. Do not silently restore an older Netlify deployment or
change DNS. Disabling profile/transaction flags does not undo settled chain
transactions. Use existing approved governance controls under their own rules;
never erase Firebase/PostgreSQL data, replay transactions, withdraw locked
principal or bypass notice as a rollback technique.

After a future Stage B activation writes new per-upload avatar versions, retain
the current backwards-compatible avatar reader/API during a profile rollback:
disable the activation flag or fix forward. Restoring the pre-avatar-removal
reader would not display those new versions. Do not rewrite records to make an
older reader work. Stage A rollback is data-safe while profile writes remain off.

## Physical iPhone acceptance

1. **Read-only now:** open the verified preview in Safari, MetaMask and Rabby.
   Check portrait/landscape, notch/home-indicator gutters, zoom, navigation,
   search focus, optional forms and wallet/account states. No signing,
   transaction, token approval or delegation prompt is expected.
2. Enable Settings → Accessibility → VoiceOver. Swipe the header, main content,
   search, menu and forms; confirm understandable names/order, visible focus,
   disclosure announcements and reachable 44px controls. Test menu Escape/close
   with an external keyboard if used. Report clipping or duplicated announcements.
3. **Only after separate authentication approval:** on the approved origin,
   connect the existing wallet, reject one gas-free SIWE request, then review
   domain/account/4663/purpose/expiry before signing in. Save a unique username,
   inspect the public profile, upload/remove/reupload an avatar, refresh, log
   out, and switch account/network. Old sessions must clear. Profile deletion
   requires its separate fresh proof and confirmation. Never sign governance
   authorization, approvals or a transaction as profile login.
4. Report URL, local/UTC time, iOS and wallet-app versions, step, exact error and
   screenshot. Never send a seed, private key, cookie or signed payload.

Physical phone, VoiceOver and live Firebase acceptance remain **not performed**.
Automated Chromium/WebKit, emulator and synthetic-inset evidence are separate.
