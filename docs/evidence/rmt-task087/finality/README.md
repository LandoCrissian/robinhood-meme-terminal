# Original schedule batch posting

**Historical L1 posting is corroborated through exact receipts. The original discovery capture remains UNVERIFIED.** These are separate retained observations, not governance execution or current-governance finality.

The fixed L2 target is the original Schedule transaction `0x96bd234e49d766c73c66f9787f26736040b4fc64d91ed2ae888eca3f4c8afb65`, block 116966133/hash `0xba98e1e82b736a50c46dfae095f1f3fd3cc4932921938c7b2aa8d30f23ec9106`. Official/Pocket witnesses bound that exact target to batch 399324 and L1 origin 26438074 at fresh common L2 anchor 118774091/hash `0xd645118aca073612911319a9fa8d665b30d716b3978bfc547c5e71ff1c936e77`.

| Retained observation | Requests | Actual result |
| --- | --- | --- |
| [Original bounded discovery](schedule-116966133/report.json), 04:20:36–04:20:41 UTC | 31 | **UNVERIFIED**. Publicnode's one bounded `eth_getLogs` request returned HTTP 403. Flashbots alone supplied the exact event/receipt. No retry, fallback or wider search followed. |
| [Separately authorized exact-receipt corroboration](exact-receipt-corroboration/report.json), 04:28:49 UTC | 8 | **CORROBORATED_FINALIZED_L1_POSTING** against the original finalized snapshot. Both original Ethereum providers supplied the exact successful receipt and matching canonical posting headers. No log search or L2 request occurred. |

All timestamps are 2026-11-20 UTC. Total finality-lane requests: **39**, each single-attempt. The second lane used the publicly discovered transaction identity with normal permitted receipt/header methods; it did not retry the forbidden log method or introduce a provider.

The exact L1 posting is block 26438078/hash `0x3a1e8c4fb85b6ec51a904da8574c580138996fa32c6e5ceadc2055fe1c8f5c52`, transaction `0x82a3521f2fc1e758097b859df2e1809c5b3f064f13683b92d2415754953d6f3a`, log 277, batch 399324, at pinned SequencerInbox `0xBd0D173EEb87D57A09521c24388a12789F33ba96`. Both receipts contain the same exact `SequencerBatchDelivered` event; its topics, canonical ABI data, successful receipt and before/after posting headers are checked.

The first capture's two Ethereum witnesses agreed on finalized block 26453807/hash `0x92091eabb57369c01c3cf027e075eda66f0dee6ffe9caa695032ed5fcac0841a`. Its finalized tags and own/common canonical-header checks are retained. The second lane rechecked that same common finalized block on both providers after the receipt checks. It does **not** claim a freshly advanced finalized tip. A missing, forbidden, altered or reorganized observation fails closed.

The trust boundary remains explicit: original L2 RPC batch membership plus two public Ethereum RPC receipt/posting/header witnesses. No independent rollup execution, batch data-availability, challenge-state, consensus-light-client or receipt-trie proof is claimed. This does not finalize current governance state, a current backend checkpoint or any future execution. No signing, broadcasting or production activation occurred.

Each capture retains original public request/response bytes in gzip, per-response hashes, exact source hashes and a raw/stored integrity manifest. Original capture files and the original collector remain unchanged. Two inherited public JSON sources were materialized locally with CRLF while Git stores LF. [source-capsules.json](source-capsules.json) authenticates their exact captured bytes; portable verification permits only CRLF/LF differences at those two fixed paths and rejects changed JSON data, extra whitespace or unrelated paths. No historical file was rewritten. The exact executed receipt producer is also archived before its source-byte reader was made portable; verification identifies that executed archive explicitly rather than claiming its current bytes are identical.

Original discovery plaintext, supplementary receipt plaintext and decompressed source capsules each passed unchanged Gitleaks8.30.1/configuration with zero findings. No exception was added. Scan records remain beside the captures and in [source-capsules-gitleaks-report.json](source-capsules-gitleaks-report.json).

The focused mocked tests cover bounded success, unsupported mapping, absent logs, conflicting witnesses, altered/removed events, finalized-height classification, forbidden receipt access and source-byte tampering. `verify-retained.test.mjs` checks the actual captured raw bytes/proofs without network. [offline-verification.json](offline-verification.json) records the combined execution. These tests verify evidence and classification; they do not repeat live calls.
