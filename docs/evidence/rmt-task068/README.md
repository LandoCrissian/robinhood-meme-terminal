# Task 068 — launchpad interface verification

Baseline: PR #663, `0cf0f23175b91ef65489abe395ae5750bb04cbaf`.
Preview application source: `ad41452b20d11910629495d7d917791646b97149`.

The homepage now starts with discovery, a single Create navigation action and a
wallet/profile disclosure. The introductory hero, four lifecycle panels,
duplicate account/creation links and contract-heavy discovery cards are removed.
Search filters locally by name, ticker, token or creator address. Its entire
control receives `:focus-within`; the inner input has no competing outline.
Historical registrations remain in the closed archive.

Optional creator fields expand in place. The edit view has compact terms;
review always shows the full committed terms before the wallet section. Field
validation, draft storage, account/chain review invalidation, transaction
identity and recovery are unchanged. Detailed canonical receipt, checkpoint,
full PoolKey, position and finality evidence has its own token-page component;
invalid lifecycle evidence cannot become funded-liquidity claims.

## Preview and boundaries

[Isolated HTTPS preview](https://6afd16c0224787428bbfa2c6--eclectic-valkyrie-16cb92.netlify.app/)
uses the existing Netlify site, deploy `6afd16c0224787428bbfa2c6`, context
`deploy-preview`, with no production publication. The production deployment
remains `6af86be73747ac95bd6d15ea`.

The hosted site is read-only and Firebase profile authentication is disabled.
Functional profile acceptance uses real Auth/Firestore emulators on loopback,
with synthetic MetaMask/Rabby provider signatures. Neither browser emulation
nor these signatures establish physical-iPhone acceptance.

No Solidity, deployed contracts, governance notices, economics, Firebase rules,
Railway worker/database, dependency versions or production settings change.
The contracts subtree is unchanged from the baseline:
`56ba9816ef5c44ae16e22b2ec3d891989073e2c3`.
Existing contract-analysis findings and release holds remain in force.

## Executed checks

- Web unit/security tests: **82 passed**, including invalid registration and
  zero-liquidity provenance rejection. The JSX test config enables the actual
  detail component to render under the test runner; no assertion is removed.
- Next.js production-style build and Netlify adapter build: **passed**.
- Public HTTP/browser regression: **passed locally and at the actual HTTPS
  preview**, Chromium and WebKit, desktop/portrait/landscape. Each hosted run
  verifies 111 denied paths and zero wallet, external or operational requests.
- Focused polish checks: **8 matrix entries passed**, both engines at 1440,
  390, 750 and 320px. Search outline is 2px on the parent and 0px on the input;
  search/clear, native keyboard behavior, menu dismissal, no overflow,
  unavailable/empty/stale states and complete detail evidence are verified.
  Safari's native Tab setting can skip links; explicit ArrowDown enters the
  Wallet link and Escape restores the trigger in both engines.
- Firebase-emulator browser acceptance: **passed Chromium and WebKit** with
  real emulator custom-token/session exchanges, profiles, avatar decoding,
  private-preference isolation, account/network changes and sign-out recovery.
  No production Firebase writes or real wallet signatures occur.
- Knip, diff checks, production dependency audit and Gitleaks Git-history scan:
  **passed**. The production dependency audit reports no known vulnerabilities;
  this does not clear existing contract warnings or claim all development
  tooling advisories are resolved.

The JSON files alongside this report contain the actual browser and deployment
evidence. GitHub CI results are linked in the PR; local results are not
represented as hosted-CI results. No fresh broad contract-analysis campaign
was performed for this interface-only change.

## Reproduce

Install using `pnpm install --frozen-lockfile`. Run:

```sh
pnpm --filter @rmt/launch-website test:history
pnpm --filter @rmt/launch-website build
pnpm check:repo
pnpm audit:production
# In another terminal, with all execution/profile activation variables unset:
pnpm --filter @rmt/launch-website exec next start -H 127.0.0.1 -p 3268
# RMT_POLISH_ARTIFACTS must point outside the repository:
RMT_POLISH_URL=http://127.0.0.1:3268/ RMT_POLISH_ARTIFACTS=/tmp/rmt-polish pnpm test:polish
pnpm test:profiles:browser
```

The profile emulator runner requires Java 21+ and strips cloud credentials. On
Windows an existing local JRE may be selected with `RMT_PROFILE_JAVA_HOME`.
The production-style public suite runs `scripts/visual-qa/rmt-netlify-website.mjs`
with `RMT_WEBSITE_BROWSER=chromium` and `webkit`, and
`RMT_WEBSITE_PREVIEW_URL` set to the preview URL. CI retains its existing
isolated lifecycle suite; its only creator-selector change opens the now
collapsed project-information fields.

`test:polish` defaults to loopback only. Its separate local React harness mounts
the actual discovery and provenance components with a visible **SYNTHETIC QA
FIXTURES** banner. These fixtures never enter the public application, API,
indexer or wallet. They test the states unavailable in an honestly empty
prelaunch feed. The exact earlier preview can be captured explicitly with
`RMT_POLISH_MODE=before`.

## Screenshots

| View | Before | After |
| --- | --- | --- |
| Desktop discovery | [Before](before-desktop.png) | [After](after-desktop.png) |
| iPhone portrait discovery | [Before](before-portrait.png) | [After](after-portrait.png) |
| iPhone portrait creator | [Before](before-create.png) | [After](after-create.png) |

[Synthetic card-layout evidence](synthetic-cards.png) shows clearly labeled
local test data, not live launches or invented market activity.

## Packaging limitation

The existing Windows preview-build procedure preserves standalone directory
links as junctions and normalizes generated Netlify archive links to portable
POSIX paths. All other regular archive files are checked byte-for-byte.
`portable-archive.json` records the artifact hash and scope of this packaging
normalization. No application authorization check is bypassed. A future
production build still needs separate publication approval; production profile
activation and physical-wallet SIWE acceptance are separate gates.
