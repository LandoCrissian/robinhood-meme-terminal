# Decompressed evidence scan

Gitleaks 8.30.1, with the unchanged repository configuration, scanned every new evidence artifact including decompressed compiler input, raw scanner output and public RPC archives. The scan examined approximately 6.11 MB and returned **raw exit 1 with one finding**. The redacted raw report and log are preserved.

The reported value is the public Solidity type name `RMTLaunchCurveLpFeeLedgerV1`, occurring in a mapping declaration in the exact compiler input. It is not a credential. `public-source-binding.json` records the exact source path, line, complete source digest and compiler input digest; the independent security verifier reconstructs that same complete input from pinned first-party and dependency source bytes.

No finding was removed from the raw report, no ignore/rule/severity changed and no clean raw scan is claimed. This explanatory source classification adds no policy exception and clears no financial or security gate. The earlier security-only directory scan result remains a dated narrower observation; this expanded raw result is the complete archive-content check.

Command: `gitleaks dir /tmp/task088b-expanded --config .gitleaks.toml --no-banner --redact --report-format json --report-path /tmp/task088b-expanded-gitleaks.json`.
