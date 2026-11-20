# Task090 — eleven graduation findings

This package addresses only the eight `position-funding` and three `curve-graduation` IDs in Task089's stage register. It preserves all 22 raw High observations, the seven governance Mediums, all 101 detectors and the failed strict gate. It authorizes no deployment, publication, financial activation or transaction. No first-party Solidity implementation changed.

## New executable evidence

`Task090GraduationProofTest` passed **6/6 tests, zero failures/skips**, with **512 fuzz cases** on each of two explicitly separate profiles:

- Ordinary checked-in 31337 / 1 ETH source, using the exact observed PoolManager, PositionManager and Permit2 runtime bytes in fresh synthetic VM storage.
- The canonical 4663 / 2 ETH build, deploying the unchanged compiler's creation bytecode through the real bootstrap, factory, RegistryV3 and DirectoryV2. Synthetic keys 1/2 admit only this isolated factory through its actual notice. The test checks the actual 2 ETH threshold and 400M-token reserve. It uses the same three genuine external runtimes. No RPC state, production wallet, public transaction or production governance action is used.

The runtime-only dependency installation explicitly initializes PositionManager's constructor counter to 1 in fresh local storage. This is neither a fork nor a copy of live pool state. Permit2's direct `approve`/`transferFrom` path is exercised; signature, permit and EIP-712 paths are outside this proof.

The named success test records every account access and requires exactly **21 ordered CALL/CREATE frames**, including the fee-ledger constructor, pool initialization, its sole initialization hook, both manager settlement calls and the authenticated dust refund. Each mutable frame binds operation kind, caller, target, complete calldata hash, native value and depth. Unknown mutable frames, delegate/callcode/selfdestruct operations, failed frames and unknown static-read targets fail the assertion. The expectation is constructed from the independently sampled funding amounts and full PoolKey. The full trace and extracted edges are retained; these are stronger than call-presence expectations.

The negative cases independently establish:

1. Shared PoolManager unlock cannot nest graduation; every tracked asset, authority, curve/pool/position state and ledger registration rolls back, and a top-level retry succeeds.
2. A correct finite Permit2 grant with an incorrect expiry reverts after the grant and rolls back all tracked state. Sequential mock responses isolate the expiry guard; this is explicitly an injected dependency response.
3. Substitution of each manager/Permit2 runtime fails before settlement and preserves the state, then succeeds after restoring the exact code.
4. An unrelated caller cannot spend curve inventory or engine Permit2 authority or transfer the original LP NFT; even PositionManager has no residual spending amount after success.
5. 512 independent native/token prefunding vectors cannot neutralize a debit, consume old balances or redirect manager credit. A sibling project's manager token balance and original LP owner/liquidity remain unchanged.

The independent Node checks passed **35/35**, with no skips. They reject changed/missing/duplicate IDs, altered first-party sources, changed chain/witness/canonical recheck, altered runtime bytes/targets/hashes, embedded Permit2 substitution, altered canonical compiler inputs/settings/sources/runtime bytes/immutable names, and equal-total recipient diversions. The Node balance oracle checks each account, not merely total balances.

## Exact successful conservation

Array order in the retained `Conservation` event is **curve, engine, PoolManager, PositionManager, Permit2, buyer, original curve-fee ledger, unrelated caller**. Native and token arrays use that identical order. `exact-conservation-and-graph.json` retains every before/after integer.

The canonical2 ETH case consumes **1,999,999,999,999,998,463 wei** and **399,999,999,999,999,999,999,987,510 token wei**. The exact PoolManager increments equal those exact curve decrements. Native dust is **1,537 wei**, token dust **12,490 token wei**; unsolicited curve prefunding remains in addition to dust. Engine, PositionManager and Permit2 prefunded native/token balances are unchanged. Token supply is unchanged. ERC-20 curve→engine and engine→Permit2 allowances, and Permit2 engine/token/PositionManager amount, all end at zero.

Original position **NFT 2**, liquidity **28,284,271,247,461,900,976,033**, is owned by the engine with zero approval, no operator grant, no subscriber and the exact complete PoolKey/full range. PoolManager ends locked with zero open deltas. The new LP fee ledger is empty. Neither original principal nor sibling custody is transferred to a caller.

## Source, runtime and live-state boundaries

The exact Windows solc 0.8.26 executable hash is `537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67`. Canonical compiler input remains `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`. Auxiliary AST selection changes no codegen setting. The shared canonical bytecode fixture is independently checked by the migration proof tooling; the three retained canonical artifacts here reproduce deployed immutable correspondence.

Two bounded read-only observations used only chain ID, block headers and `eth_getCode` through the existing official and Pocket endpoints. The original 14-call capture remains byte-for-byte at `initial-external-runtime-observation.json`; the shared external-runtime fixture points there. A separate 20-call capture adds live initialization guard, graduation engine and factory at block `0x71ad781`, hash `0xb046e7ad1052e3c8c72aaf1b63de9e2e03f6c87bddfac4111fca0b8398b46859`. Both witnesses match every retained pin and recheck the canonical header after code reads. Raw code is retained. No calls, simulation, gas estimation, funded RPC test or state-changing method was sent.

`canonical-live-runtime-correspondence.json` independently materializes the canonical compiler's immutable guard, engine and factory using their actual deployed bindings. All three hashes and byte lengths exactly match both fresh witnesses. This establishes current source/compiler/runtime identity for these contracts, not arbitrary production storage or all future allowed pool states. No live project token/curve was created or tested. A future original token/curve must still bind the admitted factory receipt, exact runtime and canonical state; a migration successor is separately scoped.

## Disposition and exact remaining assumptions

The new evidence establishes a concrete conserved graduation path with genuine dependency bytecode, a complete observed callback graph, and independent negative checks. Under the admitted immutable token, engine, guard, manager and Permit2 implementations, the reviewed `MINT_POSITION`/`SETTLE_PAIR` action sequence has no attacker-selected receiver, hook or subscriber callback that can neutralize the flagged baseline while diverting the tracked assets. The curve seals trading before its grant; the fixed token has no receiver callback; Permit2 approval only updates bounded allowance; PoolManager calls only its unlocking PositionManager; the canonical guard enables only passive `beforeInitialize`; the unsubscribed NFT mint makes no receiver callback; the refund receiver authenticates the engine and performs no external call.

This is a finite, source/runtime-bound defensive proof, not a claim that every external v4 state, arithmetic branch, current production pool, signer policy or L1 finality condition has been proved. It does not cover alternate actions, fee-on-transfer/callback tokens, changed code pins, subscriptions, future successors, Permit2 signatures, or state not admitted by the fixed factory. Such changes require new proof. No confirmed first-party defect was demonstrated, so no separately versioned patch is justified by this package. The raw scanner and stage/owner financial decisions remain separate and unchanged.

Existing 112-test/14-suite retained Foundry evidence remains in Task088B. Actual PR684 source `b79515752ef42e88850ac2cea953955a3bb03087` contracts CI completed successfully in job 136386584187/run 44764844542, artifact 14644691205 (`foundry-build-log`, archive digest `50c3cb2cf19494c8d2455aa083b9829615f012b407baa3e14611efbf943d16b4`). Those existing results are not substituted for these new proof runs or for the unchanged strict failure.

## Reproduce

Install the exact pinned dependencies and verified native tools using the existing repository instructions. From repository root, with absolute `$forge`, `$solc`, `$out` and `$cache` paths:

```powershell
& $forge test --root packages/contracts --offline --use $solc --out $out --cache-path $cache --match-contract Task090GraduationProofTest --fuzz-runs 512 -vv
$env:RMT_TASK090_GRADUATION_CANONICAL='true'
& $forge test --root packages/contracts --offline --use $solc --out $out --cache-path $cache --match-contract Task090GraduationProofTest --fuzz-runs 512 -vv
node --test scripts/security/graduation-proof.test.mjs
node scripts/security/graduation-proof.mjs --read-recorded-proof docs/evidence/rmt-task090/graduation/canonical-full-trace.txt <new-output>
node scripts/security/graduation-proof.mjs --verify-canonical <canonical-compilation-json> docs/evidence/rmt-task090/graduation/runtime-observation.json <new-output>
```

The canonical compilation is regenerated with `compileFixedSupplyProfile({solc, chainId:4663, includeImmutableNames:true})`; serialize `immutableNames` as entries. `--observe-runtimes <new-output>` makes only the 20 bounded read operations above. It never accepts a signing or transaction method. `manifest.json` records exact source/artifact digests and results. Initial prank/expectation and concurrent migration compile failures are retained with their causes; subsequent success does not erase them.
