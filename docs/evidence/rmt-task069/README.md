# Task 069 — current launchpad quality evidence

Continues PR #665 from `8b22fa0d2737f96648c7a184a532c13fbbf0a87d` and its
[owner instructions](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/665#issuecomment-6968576357).
No historical registrations render on the homepage. Historical data, its
standalone read API and canonical receipt identities remain intact.

## Corrections

- Updated the stale Firebase and website browser assertions that still
  expected the removed archive. Authentication, historical API evidence and
  all 111 denied-path checks remain enabled.
- The earlier web CI run timed out while downloading Ubuntu packages from its
  regional HTTP mirror, before browser tests started. The web runner now uses
  the official HTTPS Ubuntu archive with the same suites and signing keys,
  bounded network retries, and unchanged Playwright installation and tests.
- Added phone safe-area padding, corrected existing light-mode header/focus,
  error, input-border and artwork contrast, and made actionable controls 44px.
- Corrected low-contrast search/form placeholders using existing theme colors.
  Card action footers align across mixed lifecycle rows without adding metrics.

## Executed verification

The final local UI run passed **8/8**: Chromium and WebKit at desktop 1440px,
phone portrait 390px, landscape 750px and narrow 320px. It checks zero, one and
15 cards in both themes, normal-text contrast >=4.5:1, focus contrast >=3:1,
44px primary targets, complete search focus, keyboard/menu behavior, clipping,
overflow, aligned footers and full project provenance. The 750px test also
derives the actual safe-area CSS with synthetic 44px side/20px bottom insets.
Theme checks wait for actual CSS transitions to settle; thresholds are unchanged.

Synthetic cards mount the actual discovery/provenance components in a
loopback-only QA harness. They never enter public app data, APIs, indexing or
wallets. All cases record zero wallet calls, writes, external requests and
page errors. These results do not establish physical VoiceOver/notch acceptance.

Also passed: 82 web unit/security tests, typecheck, optimized Next.js build,
Knip and production dependency audit. Updated public HTTP/browser checks pass
locally in Chromium/WebKit. Real Firebase-emulator browser authentication,
profiles, avatars, private preferences and recovery pass in both engines.
No production Firebase record, rule, service or credential is modified.

The application runtime tested locally is `ab1291d0`; later QA/evidence commits
do not change runtime inputs. Exact hosted source, URL and exact-head CI results
are recorded in PR #665 after deployment. Pending checks are not counted as passed.

## Screenshots and reproduction

[Desktop](desktop.png) · [Phone portrait](portrait.png) ·
[Phone landscape](landscape.png) · [Light mode](light.png) ·
[Synthetic cards](synthetic-cards.png)

```sh
pnpm install --frozen-lockfile
pnpm --filter @rmt/launch-website test:history
pnpm --filter @rmt/launch-website build
pnpm --filter @rmt/launch-website exec next start -H 127.0.0.1 -p 3269
# In another terminal, artifacts outside the repository:
RMT_POLISH_URL=http://127.0.0.1:3269/ RMT_POLISH_ARTIFACTS=/tmp/rmt-quality pnpm test:polish
pnpm test:profiles:browser
```

Physical MetaMask/Rabby, Firebase sign-in, VoiceOver and device safe-area
acceptance remain separate. Hosted authentication and transactions remain off.
Production, deployed contracts, governance notices, economics, Railway and
Firebase data are unchanged. Contracts subtree remains
`56ba9816ef5c44ae16e22b2ec3d891989073e2c3`; existing security findings and release
holds are not cleared by interface tests. No production publication or merge.
