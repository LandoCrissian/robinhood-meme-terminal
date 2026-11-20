# Task 090: six migration observations, exact canonical path

This is a bounded defensive proof of the canonical V1→V2 migration and, separately, the canonical V2→V3 template after isolated admission. It establishes no reachable mutable balance callback at the six flagged baselines for those exact implementations. It does not clear all future templates, the raw strict scanner, the seven governance Medium observations, or any financial activation hold. No production source, deployed state, credentials, governance, wallet or transaction was changed.

## Identity and execution

The reviewed repository base is `b79515752ef42e88850ac2cea953955a3bb03087`. `source-runtime-binding.json` binds all 16 original first-party files, all 50 dependency files and the six exact Task 089 IDs. All production Solidity remains unchanged. The canonical 4663 compiler input is `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`; the auxiliary input adds AST output only, producing `7923ec6acc0666f18c7dd9d8d181eb15d5e664be841325f0787b0dd046132426`. Compiler settings, every creation/runtime template digest and all immutable names were verified against the retained release profile. Both exact compiler inputs and the actual raw compiler output are byte-preserved in the gzip artifacts listed in `compiler-artifacts.json`.

The local 4663 run deploys the canonical compiler's creation bytecodes, rather than recompiling production contracts with test remappings. This preserves embedded child creation code and compiler metadata. Real canonical Directory V2 and Registry V3 are constructed with synthetic addresses and test-only signers; their real admission/notice methods run inside the isolated VM. The factory's graduation binding is a fixture because migration never calls graduation. Token, curve, original ledger, factory, registry, directory and both successor deployers otherwise use the exact canonical bytes with synthetic constructor identities. The suite asserts the actual original curve's graduation backing is 2 ETH and token runtime is canonical. Neither mainnet forks nor live accounts/RPC calls participate in the Foundry run.

`runtime-observation.json` separately records two public witnesses, five exact deployed infrastructure runtimes, block `0x71ade63`, hash `0xe336ee0fe772d41cd6939ccbd994f629cd1bc254d2ff7901178dcb0e06989023`, and canonical post-read rechecks. Its 18 RPCs are limited to chain ID, block headers and `eth_getCode`. Materializing the canonical immutables reproduces those five deployed runtime hashes and the four retained constructor initcode hashes. This is runtime correspondence, not an admission or governance-state observation. No project curve or revenue ledger is claimed to be deployed: their code identity follows the exact factory/deployer creation paths exercised locally.

## Concrete conservation

The graph test starts with a 0.3 ETH buy, already-claimed creator/operations fees, still-unclaimed treasury/reserve fees, and deliberately prefunded token/native surpluses on both predecessor and successor. Values below are integer wei; `conservation-vector.json` retains every recipient, bucket and balance before migration, after migration, and after all remaining earned claims.

| Quantity | Before | After migration |
| --- | ---: | ---: |
| Source native | 297000000000000091 | 91 |
| Successor native | 30 | 297000000000000030 |
| Source token | 875587619269257621596462706 | 57 |
| Successor token | 19 | 875587619269257621596462668 |
| Original ledger native | 750000000000000 | 750000000000000 |
| Total accrued | 3000000000000000 | 3000000000000000 |
| Already claimed | 2250000000000000 | 2250000000000000 |
| Treasury earned/unclaimed | 600000000000000 | 600000000000000 |
| Reserve earned/unclaimed | 150000000000000 | 150000000000000 |
| Factory creation fees/native | 400000000000000 | 400000000000000 |

Exactly `B = 297000000000000000` native wei and `I = totalSupply − sold = 875587619269257621596462649` token wei move. Each source/destination debit and credit is individually exact, including its prefunded surplus; the combined source/destination assets, fixed total supply, holder tokens and original fee state are unchanged. Afterwards, each beneficiary receives exactly its remaining credit, ledger balance/credits become zero, and total claimed equals the original accrued 3000000000000000 wei. The independent JS vector verifier rejects changed asset deltas, earned credits, payouts or profile labels.

The 512-case fuzz test varies buy budget, pre-existing token/native surpluses and earned claims, and asserts the same complete conservation and post-migration withdrawal rights. A separate real V2→V3 transition retains the original ledger and requires separate template publication/creator/quorum consent.

## Callback graph and six finding bindings

State-diff recording accepts exactly these six mutable CALL frames, in order: test caller→Registry.executeMigration; Registry→Factory.executeMigration; Factory→source.migrateAssets; source→canonical token.transfer; source→original Ledger.moveAccrual; source→canonical successor.acceptMigration. Only the final call carries value B. Delegatecall, callcode, create and selfdestruct are forbidden throughout this recorded migration. Exactly one ledger SSTORE is permitted: activeCurve changes to the successor. Every fee-bucket/credit/claimed/native balance is separately asserted unchanged.

Canonical token.transfer is the pinned fixed-supply OpenZeppelin ERC20 implementation without hooks/overrides or external calls. Canonical Ledger.moveAccrual checks the existing writer, checks successor code, writes the writer and emits; it calls no external contract and does not move escrow/credits. Canonical acceptMigration performs pure arithmetic, token/source/ledger STATICCALL getters, guarded own-state writes, and no outgoing mutable CALL. Thus none of the three flagged interactions supplies a mutable callback capable of invalidating these baselines under the exact code/dependency assumptions.

| Exact finding ID | Flagged interaction and baseline | Concrete binding |
| --- | --- | --- |
| `04dd86035f4ee7098c24bb34ee716fb14d25372ec3714df5c746a364f9aa83d9` | ledger writer switch; successor token baseline | Call-free writer-only ledger; exact successor token increment I after all interactions. |
| `1fdf2b7ea9c9f97d447984c8465928fb275e1762930f87972a33d2dedc10f9da` | token transfer; predecessor token baseline | Exact non-hooking ERC20 transfer; source debit I reconciled against the complete pre-transfer balance. |
| `7f0d825327586187a4f0c915e12ad0b7ecb6555643bb51e223e5ec407788b16a` | successor acceptance; successor token baseline | Canonical acceptance has no outgoing mutable call; successor credit I remains exact after activation. |
| `be7b3e4ab44843109965a75e105e1eeda02e07c291640eecad1a6a313afdbdee` | successor acceptance; predecessor token baseline | Acceptance cannot mutate predecessor/token through its STATICCALL getters; predecessor debit I remains exact. |
| `c87c792deb6a8d1b2cd802f5d698e711471eeec6436202d64d463d82af745826` | token transfer; successor token baseline | Canonical transfer credits only recipient by exactly I; prefunded successor tokens are preserved. |
| `d7b62a52dbdc751f89829f6663cbbdb7c775d05f9aa0b6364b707aaa531573fe` | ledger writer switch; predecessor token baseline | Ledger has no token call, predecessor token debit cannot change there; the one writer SSTORE and full escrow/earned rights are asserted. |

## Rejection, rollback and authority

The focused suite rejects absent creator consent, duplicate quorum signers, wrong adjacent version, direct unauthorized source calls, an immature notice, pause, cancelled/expired consent and post-signature runtime replacement. Failed execution snapshots preserve both curves' complete assets/accounting, original fees/claims, raw proposal, nonce, directory epoch/pause, factory route and canonical registry route. Runtime restoration permits retry of the identical valid proposal.

A VM-only hostile successor, whose injected codehash is deliberately included in synthetic consent, diverts one native wei after otherwise genuine acceptance. Exact settlement reverts its receipt, assets, ledger writer, proposal and routes atomically; removing the synthetic fault permits the same proposal to complete. A funded VM-only hostile ledger exercises the existing route/reentrancy probe and attempts a post-writer-switch successor buy: CurveClosed reverts all state. These are local counterfactuals, not live runtime replacements or templates asserted reachable in production.

The additional mutable-ledger counterfactual deliberately transfers one ledger wei while preserving outer curve deltas. Migration can then complete with one wei less fee backing. This demonstrates the exact boundary: outer source/destination delta checks do not independently protect an arbitrary replaceable ledger. The canonical original ledger is constructor-bound, has no proxy/delegatecall/upgrade/selfdestruct path, and its writer-switch has no outgoing call or fee mutation. Its unchanged identity and implementation are required proof assumptions. This counterfactual is not reported as a defect reachable against the canonical immutable ledger.

Registry's raw proposal/migrationNonce getters retain precommit state during the handoff. All V3 consumers that mutate proposal/nonce are nonReentrant; project, migrationDigest and nextMigrationVersion reject under migrationInProgress. Factory hides its own route during settlement. The exact current callback graph contains no mutable external consumer to exploit the raw getters; existing injected token/ledger/acceptance callback regressions challenge those guards. A source search found no active website/indexer/script consumer of these migration getters. Unknown third-party consumers and the seven governance Medium findings are not cleared.

The first adjacent transition uses the immutable factory-pinned canonical V2 deployer. V2→V3 coverage is conditional on independently admitting the exact canonical V3 template. Codehash/metadata admission of an arbitrary future template is not behavioral proof; repeat this path and recipient/earned-right/callback analysis for each admission. No source repair is proposed because no reachable defect in the canonical pair was established.

## Results and reproduction

`foundry-default-31337.log`: 9/9 focused tests, zero failures/skips, 512 fuzz runs; ordinary repository 1 ETH backing economics. `foundry-canonical-4663.log`: 9/9 focused tests, zero failures/skips, 512 fuzz runs; exact canonical 2 ETH backing bytecodes. `initial-fixture-failure.log` preserves the first 8/9 run: the hostile callback lacked its required 0.05 ETH and reverted before producing CurveClosed. Funding that test-only callback fixes the fixture without changing the assertion or production code.

The existing [b795 contracts CI](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44764844542/job/136386584187) independently ran 112 tests in 14 suites with zero failures/skips and 512 fuzz runs. That is the unchanged default 1 ETH profile and is not substituted for this new canonical 4663 run.

```powershell
$tools = (Resolve-Path '..\task090-tools').Path
node scripts/security/migration-proof.mjs compile --solc "$tools\solc-0.8.26.exe" --output "$tools\fresh-canonical-compilation.json" --fixture "$tools\fresh-canonical-fixture.json" --solc-cache "$tools\fresh-canonical-cache"
# Compare the fresh fixture byte-for-byte with test/fixtures/task090-migration-profile.json before execution.
& "$tools\foundry-1.7.1\forge.exe" test --root packages/contracts --use "$tools\solc-0.8.26.exe" --offline --out "$tools\migration-out" --cache-path "$tools\migration-cache" --match-contract Task090MigrationProofTest -vv
$env:RMT_TASK090_MIGRATION_CANONICAL='true'; $env:RMT_TASK090_MIGRATION_CHAIN_ID='4663'
& "$tools\foundry-1.7.1\forge.exe" test --root packages/contracts --use "$tools\solc-0.8.26.exe" --offline --out "$tools\migration-out" --cache-path "$tools\migration-cache" --match-contract Task090MigrationProofTest -vv
Remove-Item Env:RMT_TASK090_MIGRATION_CANONICAL; Remove-Item Env:RMT_TASK090_MIGRATION_CHAIN_ID
node --test scripts/security/migration-proof.test.mjs
node scripts/security/migration-proof.mjs verify --compilation "$tools\fresh-canonical-compilation.json" --fixture packages/contracts/test/fixtures/task090-migration-profile.json --observation docs/evidence/rmt-task090/migration/runtime-observation.json --output "$tools\fresh-migration-binding.json"
```

Windows tools: Foundry 1.7.1 commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`, official ZIP digest `6d41121b4bbb809845821c903619cfee75ed364f2bdc58a6787c9b0454114537`; pinned native solc 0.8.26 executable digest `537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67`. Required pinned dependencies retain all 50 source identities; an ancillary recursive ds-test install encountered Windows path length and was not used to bypass any source check. No administrator/global configuration changes were made.

`binding-tests.log`: all nine JS tests pass, including deliberate source/dependency drift, altered/missing IDs, wrong canonical bytecode/economics, mismatched or truncated runtime bytes, extra RPC scope, canonical-recheck/signing changes, modified asset/credit/payout values, loss of integer precision, and attempted default-profile relabeling.

The unchanged Gitleaks 8.30.1 scan of this cluster, with archive traversal depth 3, returns **raw exit 1 and five findings**. `gitleaks-raw-redacted.json` and `gitleaks-raw-exit.txt` retain that result. Two findings are the existing public Solidity type identifier `RMTLaunchCurveLpFeeLedgerV1` in the canonical/auxiliary compiler inputs; three are public source-content digests in the original canonical manifest (Token V2 twice and pinned dependency PoolKey once). `gitleaks-public-proof.json` binds each to the unchanged source and retained digest; no credential material was found in those five exact matches. The scanner/configuration/ignore files and raw compiler artifacts are unchanged. This classification does not report a clean raw scan or alter any repository gate.

The raw 101-detector observations and Task 089 dispositions remain unchanged. No signing/broadcast, governance execution, production mutation, live vulnerability testing, or financial activation is authorized by this evidence.
