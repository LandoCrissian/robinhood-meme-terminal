# Task 089: changed-source and expanded-evidence secret scan

Gitleaks **8.30.1** ran locally on Windows with the unchanged repository `.gitleaks.toml` and `.gitleaksignore`. Both policy files were byte-compared to immutable starting commit `78a76feb592ac136dbf74d4823c21db64a6d0313` before execution. The official Windows release archive digest and extracted executable identity were verified; no paid service or remote execution was needed.

The retained snapshot covers changed tracked source, new untracked repository source and every new Task 089 evidence file, including Git-ignored evidence logs. Every `.gz` artifact is also decompressed into the scan snapshot with a bounded 32 MiB limit; the inventory records both compressed and expanded identities. The scan does not traverse a user's home, other repositories or dependency directories.

**Raw scanner exit: 0. Findings: 0.** No public-value classification or scanner exception was needed. The exact capture time, source-file count, expanded-gzip count, per-file digests, unchanged policy identities and redacted report digest are in `scan-manifest.json`. Raw output and the empty redacted report are retained as `gitleaks.txt` and `gitleaks-redacted.json`.

This is a scoped snapshot result, **not a clean full-history claim or financial clearance**. The retained raw strict contract scanner and historical Gitleaks observations remain unchanged. Any source edited after the inventory's capture needs a fresh scan or exact-head CI. To avoid a self-reference, only this scan's three generated inventory/report/log outputs are excluded; the manifest names them explicitly. The producer, this README and tool-provenance record remain in scope. The derived outputs contain only public source hashes, redacted scan data and fixed scanner summaries.

Reproduce from the repository with the official verified Windows executable and a **fresh output directory outside the repository**:

```powershell
node docs/evidence/rmt-task089/archive-scan/scan-changed-source.mjs --gitleaks <verified-gitleaks.exe> --output <fresh-external-directory>
```

The producer refuses an existing output directory, altered policy or executable, source/evidence symlinks, unsafe inventory paths, decompression overflow and scanner execution errors. It preserves a raw exit of 1 if findings exist; it does not convert findings to success. No authentication, secret, ignore rule, detector or severity was changed.
