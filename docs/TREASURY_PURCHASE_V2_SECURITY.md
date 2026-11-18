# Treasury V1 findings and V2 prototype security disposition

**BLOCKED_NO_BROADCAST. Internal engineering evidence, not an independent audit.**
Task 077 preserves the immutable Task 076 V1, all existing launch contracts,
economic commitments, beneficiaries and LP principal custody. The new V2 is a
local-only, noncustodial route/reference prototype: it cannot purchase, receive
ETH through a payable method, approve tokens, call a mutable router, transfer V1
funds or inherit V1 fee entitlements. A zero-high result for that narrower new
artifact is **not** removal of the six findings in the asset-bearing V1.

## Reproduced scope and exact results

| Scope | Compiler input SHA-256 | Actual Slither result | Gate |
| --- | --- | --- | --- |
| Unchanged V1, all three production sources and every reachable import | `513609f57dea2fd706ac749999c47119955be16bb0b4f46a54b9fc4283683cf0` | 101 detectors; 25 findings: 6 high, 4 medium, 10 low, 5 informational. All six high IDs exactly match Task 076. | **Failed**, exit 1 |
| V2 prototype, all three production sources and every reachable import | `39c67e76e2133da84939693c6f06e1eeea714cffdd6fd7264ca3026fbd944455` | 101 detectors; 3 findings: 0 high, 0 medium, 2 low, 1 informational. | New scope passed, exit 0; no release clearance |
| Existing 4663 launch deployment closure | Retained separately in `docs/evidence/fixed-supply-security/slither-4663.json.gz` | Original **22 highs: 18 engine plus four dependencies**. No source or disposition changed here. | Existing gates remain failed |

Fresh reproduction used **Slither 0.11.5**, **Crytic Compile 0.3.11**, native
**solc 0.8.26+8a97fa7a**, Cancun, optimizer 200, via IR, IPFS metadata. The Windows
compiler SHA-256 is
`537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67`.
No detector, severity, source-path filter, suppression or exact balance check was
changed. The existing analyzer materialized each complete compiler input in a
fresh outside-worktree directory. Raw reproduced reports, full IDs, source
hashes and test identities are in [the machine register](evidence/rmt-task077/security/disposition.json).

## Six individual high findings

Every row is `reentrancy-balance`, High. Locations below refer to the unchanged
`packages/contracts/project-treasury/src/RMTProjectTreasuryV1.sol`; `_tokenCall`
performs `asset.call(data)` at line 245. The scanner correctly identifies an
external mutation between two balance reads. Its stale-balance model does not
by itself prove that this mutation can reenter the admitted concrete token or
that the exact-delta assertion permits value loss.

**Disposition of all six:** internally disputed as a reachable loss path under
the exact admitted code and configuration; **retained and unresolved for the
strict gate**. No confirmed defect was established by this work. Passing tests
do not prove absence of every vulnerability or clear a warning.

| Full-ID prefix | Exact data flow and possible adversary | Protected state and targeted new test |
| --- | --- | --- |
| `9c16c8a3bc20706d` | `_depositToken`, 212–220: treasury `beforeBalance` at 214; `transferFrom` at 216; treasury exact `beforeBalance + amount` at 217. A depositor would need an admitted token with callback or nonstandard balance behavior. | `nonReentrant`, runtime-bound admission, caller-only debit and accounting only after exact deltas. `testDepositRecipientShortCreditRollsBackAllowanceBalancesAndAccounting` proves counterfactual short credit reverts, including allowance and sender balance. |
| `e44f38f8b3bb8d42` | Same call; sender `senderBefore` at 215 and exact sender debit at 218. A malicious token could debit more than the declared amount. | `testDepositUnexpectedSenderDebitRollsBackAllowanceBalancesAndAccounting` independently falsifies acceptance of extra debit; no incoming credit remains after revert. |
| `9c89e25d6f7b221a` | `executeWithdrawal`, 319–333: treasury `beforeTreasury` at 328; transfer at 329; exact outgoing debit at 330. A caller executing a matured request cannot choose its asset, recipient or amount. | The fixed current-epoch request and reservation are consumed before payment; guard, exact token runtime and transaction rollback remain. `testWithdrawalUnexpectedTreasuryDebitRollsBackReservationAndTransfer` proves over-debit preserves the original pending request, reservation, balances and withdrawn total. |
| `3795d593ed7ec3b9` | Same transfer; recipient `beforeRecipient` at 327; exact destination credit at 330. A malicious recipient cannot receive an ERC-20 callback from the admitted Token V2. | `testWithdrawalRecipientShortCreditRollsBackReservationAndTransfer` proves short destination credit cannot mark a withdrawal complete or lose its reservation. |
| `f0d7abc79470e6d8` | `claimLp`, 191–202: token `beforeToken` at 195; combined original-ledger `claim()` at 196; exact received token amount at 199. Exploitation would require a misbehaving pinned engine-created ledger or token. | Controller authorization, treasury and ledger guards, immutable beneficiary policy, exact ledger/runtime identity, native receive accounting, exact token delta and original LP custody. `testCombinedLpWrongTokenAmountRollsBackAllAssetsAndFeeCredits` proves a misreported return rolls back both native and token settlement and restores credits. |
| `ce5b86d1c1f6d103` | Same token snapshot; single-asset `claimAsset()` at 197 and the same exact check at 198–199. | `testSingleAssetLpWrongTokenAmountRollsBackAllAssetsAndFeeCredits` tests the separate entry. Native-only and token-only scope cannot silently fabricate the other currency. |

Full individual IDs and source/read/call/assertion line numbers are recorded in
the machine register rather than truncated there.

### Reachability, authority and assumptions

The real Token V2 is `RMTLaunchCurveTokenV2`, an ordinary OpenZeppelin ERC-20 with
one constructor mint and no callback, tax, rebasing, proxy or mutable behavior.
Admission requires the exact token runtime, one billion supply, 18 decimals and
an actual original registration in the pinned factory. A controller cannot make
an arbitrary token trusted by supplying its hash. `_asset` rechecks the exact
runtime before every token movement. A hypothetical compromised deployment pin
or future widened admission rule is a different review premise, not a present
permission to accept hostile tokens.

The exact pinned graduation engine constructs `RMTLaunchCurveLpFeeLedgerV1`
itself during graduation. The ledger preserves beneficiary policy and employs
checks/effects before token/native payments plus its own `nonReentrant` guard.
The treasury verifies the engine, original locked position, ledger policy,
engine/token binding and stable ledger identity. Its native receive path only
records actually received ETH; it makes no outgoing call. Public `bindProject`
only admits the same immutable original project identity and cannot turn a
callback into a different beneficiary or mutable call target.

Authorized controllers can still authorize their own noticed withdrawal and
change their external wallet's own policy. These are disclosed trust powers,
not permission for RMT or a keeper to confiscate funds. Losing controller/quorum
has no platform override. This review does not establish continued honesty of an
arbitrary future token, wallet, engine, compiler or deployment input.

### New tests and their limits

`packages/contracts/treasury-purchase-v2/test/V1SecurityDisposition.t.sol` contains
**13 passing tests, including one 512-case fuzz test**, against the unchanged V1.
Its configurable fault token and ledger are explicitly **counterfactual mocks**:
the test supplies synthetic wrong runtime pins and a mutable mock engine to
exercise defense in depth. They cannot be admitted under the real approved
Token V2/engine runtime. They are not demonstrations of an exploit against a
public contract, nor proof that a mock is the approved implementation.

Besides the six individual checks, tests cover false/malformed token returns
after attempted movement, guarded callbacks into deposit reconciliation,
withdrawal replay, LP callback reentrancy, native return mismatch and credit
rollback, changed token runtime rejection, and exact token conservation during
callbacks. Correct claims retain original position ID, owner and liquidity.
No signature, public transaction, production data or real assets are used.

Retained Task 076 tests separately exercise rejected native receivers and
callbacks, real pinned Token V2/ledger behavior, migration continuity, Safe
execution, original LP custody, PostgreSQL restart and reorg recovery. Those
existing results remain separate from this new counterfactual matrix.

### Remediation choices

1. **Retain exact checks and narrow runtime admission.** This preserves solvency
   and rollback; it leaves Slither's conservative high observations visible.
2. **Remove snapshots/checks or move them behind opaque helpers.** Rejected: that
   would reduce safety or merely obscure analysis without preventing a new loss
   path.
3. **Generalize asset interfaces or add arbitrary mutable routing.** Rejected:
   that invalidates the no-callback premise and needs a new reviewed custody and
   settlement model.
4. **New executable purchasing treasury.** Not established by this prototype.
   It requires an accepted independent reference, immutable canonical route,
   exact output settlement, original-principal exclusion and separately tested
   authority/custody. The prototype has no authority to spend V1 assets or move
   its future fee credits. It is not a remedy applied to an existing V1.

## New V2 observations

Two Low `timestamp` rows concern deliberate freshness/future/deadline checks in
`PurchaseEvidenceV2.inspect` and `RMTTreasuryPurchaseV2Prototype.reviewRequest`.
No timestamp yields admitted evidence: even an otherwise well-formed observation
remains `Unadmitted`, and execution always reverts. Synthetic time advancement is
test evidence only. The Informational `too-many-digits` row is the exact compiled
creation template used for CREATE2 prediction, not an economic literal or an
arbitrary destination. All three remain in the raw report.

The prototype's nonzero caller-supplied source/price/liquidity fields, displayed
quote, caps and slippage assertions are **not independent market evidence**.
No oracle-source list can be enabled later. Its zero-high result is expected for
a no-custody/no-spend boundary and is not a claim of purchasing readiness.

## Reproduce without live execution

Use fresh absolute output paths. Existing compiler scripts checksum the native
compiler and preserve every source/import; the analyzer returns 1 for V1's six
highs and 0 for the new prototype scope.

```sh
node scripts/treasury/compiler.mjs --solc /absolute/path/solc \
  --standard-json /fresh/v1-input.json --manifest /fresh/v1-manifest.json
python docs/evidence/rmt-task043/analyze-rotation.py /fresh/v1-input.json \
  /absolute/path/solc /fresh/v1-sources /fresh/v1-slither.json
node scripts/treasury-v2/compiler.mjs --solc /absolute/path/solc \
  --standard-json /fresh/v2-input.json --manifest /fresh/v2-manifest.json
python docs/evidence/rmt-task043/analyze-rotation.py /fresh/v2-input.json \
  /absolute/path/solc /fresh/v2-sources /fresh/v2-slither.json
forge test --root packages/contracts/treasury-purchase-v2 \
  --use /absolute/path/solc --match-contract V1SecurityDispositionTest -vvv
```

The separate new test root uses an explicit `project-treasury/` remapping only
to import unchanged V1 sources and mocks. Production closure compilation starts
from every new production source; no test or source-path exclusion conceals an
applicable production dependency. Core and V1 gates stay available and failed.
