# Legion visual QA

The Legion visual-QA lane checks the current curated Token Terminal and public NFT Terminal against deterministic, loopback-only fixtures. It has two independent layers:

1. semantic DOM assertions for product invariants; and
2. exact Windows screenshot comparisons against ten reviewed baselines.

The fixtures never discover markets or call live DexScreener, OpenSea, or private NFT indexers. Their values are deterministic rendering data, not claims about historical or live markets. Public wallet submission and NFT execution remain disabled.

## Workstation commands

From the repository root, run the normal check:

```powershell
pwsh -NoProfile -File scripts/legion-visual-qa.ps1
```

The command validates the local prerequisites, proves the eight Token fixtures still match the production curated registry, installs/checks the repository-pinned Chromium browser, builds RMT, starts a loopback production server, runs Token and NFT semantics, captures the ten states, compares every pixel, writes a report, and stops the server. Transient output is written to `.artifacts/legion-visual-qa/latest/` and is not committed.

Baseline replacement is a separate, explicit operation:

```powershell
pwsh -NoProfile -File scripts/legion-visual-qa.ps1 -UpdateBaselines
```

Only owner-reviewed visual changes should use that command. A normal check never modifies expected images.

Use `-SkipBuild` only after the current checkout has already completed a successful production build. `-CaptureOnly` runs semantic assertions and screenshot capture without comparing or updating baselines.

## Baseline and CI policy

Committed expected images live in `tests/visual/legion/baselines/windows/`. Their platform is explicit because text rasterization and browser rendering can differ between Windows and GitHub's Ubuntu runners. The Windows check uses a zero-pixel tolerance; a mismatch preserves the actual screenshot and creates a magenta diff image that identifies the failing state and viewport.

The existing `Terminal visual v2` workflow first imports the production curated registry and verifies every fixture identity and canonical-market field, then reuses the deterministic fixtures for semantic assertions and bounded screenshot capture on Ubuntu. It does not compare Ubuntu renders to Windows baselines. This keeps cross-platform structure authoritative without hiding operating-system variance behind a large tolerance.

The shared semantic lane also preserves the pre-existing visual UX guards: non-exempt interactive controls remain at least 32 CSS pixels tall, market hero actions remain inside their container, Community/RMT Live stays off focused trading surfaces, the mobile signal card retains its 140 CSS pixel bound when present, and document overflow remains zero. NFT registration corners are checked against the current computed design roles: RMT green at upper-left and neutral technical at lower-right.

## Primary states

Desktop `1440x900`:

- Token scanner / Markets
- selected Token asset workspace
- NFT catalog
- CCFF00 Project Market
- CCFF00 item `1`

Mobile `390x844` captures the same five states. CCFF00 is the sole public NFT fixture project; `WATCHING` projects remain absent, and no NFT execution controls are admitted.
