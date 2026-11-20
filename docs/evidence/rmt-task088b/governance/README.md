# Task 088: separate read-only governance status

At **2026-11-20T13:10:12Z**, the official and Pocket RPCs independently agreed on canonical block **119073423**, hash `0x608b5444e8eb3c1cf843039a48840589a11a2fcd2e410cae3435ba3169b6ef9a`.

The factory-publication digest remained pending and time-eligible: nonce 0, signer-set epoch 1, not suspended, latest version 0, no published/current factory and factory engine version 1. The inclusive expiry was **2026-11-26T19:50:06Z**, with **542394 seconds** remaining at that observation. Permissionless publication remained possible. This is a dated observation, not a guarantee about later state and not authorization to execute, cancel, sign or broadcast.

The capture ran at sandbox source commit `a0fe78ff070041cb0028be71e1a6faf2825a8e5f`, whose tree exactly matches published website candidate `be44e7eaee34d2cdfad07cef736068ba008b9fd9`. This differs from the scanner/local-test starting commit `b02a0c2`; contract and retained protocol evidence bytes are unchanged.

The exact 28 public RPC requests and raw responses are archived in `read-state.json.gz`. The permitted methods were only `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode` and `eth_call` for the enumerated public view getters. No execution, cancellation, gas estimation, state-changing simulation, transaction preparation or wallet interaction occurred. Directory and factory bytecode hashes matched retained pins. This does not freshly establish all core dependency identities, external implementation correctness or L1 finality.

`capture-getters.mjs.gz` preserves the exact executed producer bytes, including its original isolated Linux checkout path. It is an audit artifact, not a portable command or an instruction to repeat network activity. The source-security reproduction in [../security](../security/README.md) remains a distinct local-only workstream and clears no findings.

The offline verifier checks archive digests, all request methods and selectors, response identities, both independent anchors and runtime pins, decoded getter values and the inclusive pending window:

```sh
node --test docs/evidence/rmt-task088b/governance/read-state.test.mjs
```

**Four tests passed, zero failures/skips**, on Node 22.16.0 using the repository's pinned viem dependency. The tests read only retained files and perform no network requests. See `offline-tests.txt` for the captured output. Raw observation and producer SHA-256 identities are in `manifest.json`.

**BLOCKED_NO_BROADCAST.**
