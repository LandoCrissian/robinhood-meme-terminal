# Final candidate scoped scan

`scripts/security/scan-task091.mjs` is the retained Task090 scanner adapted only to the Task091 base/evidence/output names. It scans every added/changed source file from exact base `27f19787ed0a2d904ba4508d2adfab1773e82e67` and all Task091 evidence, including lossless gzip expansions up to the unchanged 32 MiB per-file bound. The original scanner executable, policy files, rules and ignore entries are unchanged. No home directory or private credential configuration is scanned or published.

The five exact derived files in `final-scan/` cannot attest their own final bytes and are the only exclusions. The manifest binds every other scanned byte and each gzip expansion. This scoped snapshot is separate from the existing strict full-history CI and financial security gates; raw findings/exits remain visible. Any classification must match an exact public identity, never an ignored unknown value.

Reproduce on a fresh external output directory with the existing verified Windows tool:

```powershell
node scripts/security/scan-task091.mjs --gitleaks <verified-gitleaks.exe> --output <fresh-external-directory>
```

See [manifest](final-scan/scan-manifest.json), [raw redacted report](final-scan/gitleaks-redacted.json), [raw exit](final-scan/raw-exit-code.txt) and [classification](final-scan/public-classification.json). A later source/evidence edit requires a new scan or exact-head CI; no historical scan is relabeled as current.
