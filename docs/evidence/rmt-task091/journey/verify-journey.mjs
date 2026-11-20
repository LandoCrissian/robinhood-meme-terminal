import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

// Offline re-examination of exact downloaded CI bytes, not a live lifecycle or
// a replacement for replaying the current candidate's existing browser suite.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const hash = b => createHash("sha256").update(b).digest("hex");
// The retained compiler helper explicitly normalizes CRLF to LF before hashing
// source text (fixed-supply-profile.mjs:14). Windows dependency checkouts may
// contain CRLF; this reproduces that exact input rule, not raw-file equality.
const sourceHash = p => hash(readFileSync(p, "utf8").replaceAll("\r\n", "\n"));
const index = JSON.parse(readFileSync(resolve(here, "evidence-index.json"), "utf8"));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
assert.equal(index.head, "27f19787ed0a2d904ba4508d2adfab1773e82e67");
assert.equal(index.syntheticMerge.tree, index.tree);
assert.equal(index.currentFinancialAuthorization, false);
const terms = { fixedSupplyWei: "1000000000000000000000000000", decimals: 18,
  curveInventoryWei: "600000000000000000000000000", initialLiquidityInventoryWei: "400000000000000000000000000",
  creationFeeWei: "400000000000000", graduationBackingWei: "2000000000000000000", tradingFeeBps: 100,
  projectBps: 9000, operationsBps: 500, reserveBps: 500 };
const mandatory = ["rejected", "accountInvalidatedReview", "chainInvalidatedReview", "lostHashRefreshRecovered",
  "insufficientFeeRejected", "indexingDelay", "restart", "reorgRollback", "mutatedRequestRejected", "wrongBinding",
  "duplicateWriterRejected", "singleCreationBroadcast", "approvalConsumed", "expiredAndSlippageRejected",
  "indexedTradeRestart", "indexedGraduationRestart", "graduationRollback", "postGraduationRestart", "postGraduationReorg",
  "rpcOutage", "unauthorizedClaimRejected", "wrongRouterAndPoolKeyRejected", "excessiveApprovalRejected", "exactCustodyPreserved"];
function profile(p) {
  assert.equal(p.chainId, 31337);
  assert.equal(p.broadcastAuthorized, false);
  assert.deepEqual(p.terms, terms);
  assert.equal(p.inputSha256, "437fb783d7dce558a05317e8b15877f6d08b9571bc12aefec360382469d53648");
  assert.equal(p.executableSha256, "d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef");
  assert.equal(p.originalSourceSha256.length, 16);
  for (const [path, digest] of p.originalSourceSha256) {
    assert.equal(sourceHash(resolve(root, "packages/contracts", path)), digest, `Original source drift: ${path}`);
  }
  assert.equal(p.sourceSha256.length, 66);
  for (const [path, digest] of p.sourceSha256) {
    // The one intentional immutable-profile transformation is explicitly
    // retained in every raw report. All 65 other compiled source hashes must
    // match current source bytes directly, including all pinned dependencies.
    if (path === "src/RMTLaunchCurveMathV1.sol") {
      assert.equal(digest, "0fabb8d5c6b9748c23c94c1917131273ee3137c7bf9775e49dc7d1335506588d");
      assert.equal(p.transformations.length, 3);
    } else assert.equal(sourceHash(resolve(root, "packages/contracts", path)), digest, `Compiled source drift: ${path}`);
  }
}
const reports = [];
let assertions = 0;
for (const e of index.reports) {
  const disk = readFileSync(resolve(root, e.path));
  if (e.gzipSha256) assert.equal(hash(disk), e.gzipSha256, e.path);
  const bytes = e.gzipSha256 ? gunzipSync(disk) : disk;
  assert.equal(hash(bytes), e.rawSha256, e.path);
  const r = JSON.parse(bytes);
  if (e.kind === "creator") {
    assert.equal(r.candidateCommit, index.head);
    assert.equal(r.browser, e.browser);
    assert.equal(r.viewport, e.viewport);
    assert.equal(r.chainId, 31337);
    profile(r.compilerProfile);
    assert.deepEqual(r.browserErrors, []);
    assert.deepEqual(r.externalRequests, []);
    assert.equal(r.receipt.status, "0x1");
    assert.equal(r.indexed.status, "created");
    assert.equal(r.indexed.chainId, 31337);
    assert.equal(r.indexed.creation.transactionHash, r.receipt.hash);
    assert.equal(r.indexed.creation.blockHash, r.receipt.blockHash);
    assert.equal(BigInt(r.indexed.creation.blockNumber), BigInt(r.receipt.blockNumber));
    assert.equal(r.indexed.totalSupplyWei, terms.fixedSupplyWei);
    assert.equal(r.indexed.tokenDecimals, 18);
    assert.equal(r.indexed.creationFee.amountWei, terms.creationFeeWei);
    assert.equal(BigInt(r.reviewedTransaction.value), BigInt(terms.creationFeeWei));
    assert.equal(r.initial.creatorInitialTokensWei, "0");
    assert.equal(r.initial.inventoryWei, terms.fixedSupplyWei);
    assert.equal(r.lifecycle.threshold.indexed.soldWei, terms.curveInventoryWei);
    assert.equal(r.lifecycle.threshold.indexed.backingWei, terms.graduationBackingWei);
    const g = r.lifecycle.graduation.verified;
    assert.equal(BigInt(g.nativeUsedWei) + BigInt(g.nativeDustWei), BigInt(terms.graduationBackingWei));
    assert.equal(BigInt(g.tokenUsedWei) + BigInt(g.tokenDustWei), BigInt(terms.initialLiquidityInventoryWei));
    assert.equal(g.poolKey.fee, 3000);
    assert.equal(g.poolKey.tickSpacing, 60);
    assert.equal(g.poolKey.currency0, "0x0000000000000000000000000000000000000000");
    assert(same(g.poolKey.currency1, r.indexed.token));
    assert.equal(g.liquidityWei, g.poolLiquidityWei);
    assert.equal(r.lifecycle.preGraduationAfterReorg.phase, "curve");
    assert.equal(r.lifecycle.preGraduationAfterReorg.feeBps, terms.tradingFeeBps);
    for (const key of mandatory) assert.equal(r.checks[key], true, `${e.browser}/${e.viewport}: ${key}`);
    assert.equal(r.checks.totalWalletBroadcasts, 24);
    assert(r.checks.missingReceiptReads > 0 && r.checks.interruptedLogReads > 0);
    for (const [key, value] of Object.entries(r.earnings.checks)) if (key !== "syntheticBroadcasts") assert.equal(value, true, key);
    assert.equal(r.earnings.productionExecution, "disabled");
    assert(same(r.earnings.settled.originalCurve, r.indexed.initialCurve));
    assert(same(r.earnings.settled.rights.creator, r.indexed.creator));
    assert(same(r.earnings.settled.curve.ledger, r.earnings.originalCurveLedger));
    assert.equal(r.successorEarnings.status, "passed");
    assert.equal(r.successorEarnings.migrations.length, 2);
    for (const key of ["restartVerified", "claimReorgRestoredCredits", "principalUnchanged"]) assert.equal(r.successorEarnings[key], true);
    const v4 = r.lifecycle.v4.settled;
    for (const asset of ["nativeWei", "tokenWei"]) {
      assert.equal(v4.accrued[asset], v4.claimed[asset]);
      assert.equal(v4.balances[asset], "0");
      const claims = v4.events.filter(x => x.kind === "lp-claim");
      assert.equal(claims.reduce((sum, x) => sum + BigInt(x[asset]), 0n), BigInt(v4.accrued[asset]));
      const byRole = role => claims.filter(x => v4.beneficiaries.some(b => b.roles.includes(role) && same(b.address, x.account))).reduce((n, x) => n + BigInt(x[asset]), 0n);
      const gross = BigInt(v4.accrued[asset]);
      // Platform is floor(10%); Project receives the outer rounding remainder.
      // Operations gets floor(platform/2); Reserve receives its odd wei.
      // Original principal is excluded from this earned-fee allocation.
      const platform = gross * 1000n / 10000n, project = gross - platform, operations = platform / 2n;
      assert.equal(byRole("creator") + byRole("treasury"), project);
      assert.equal(byRole("operations"), operations);
      assert.equal(byRole("reserve"), gross - project - operations);
    }
    assertions += mandatory.length + 35;
  } else if (e.kind === "wallet-claim-wallet-acceptance") {
    assert.equal(r.chainId, 31337); assert.equal(r.productionExecution, false); assert.equal(r.status, "passed");
    assert.equal(r.coreReceiptCount, 32); assert.equal(r.reviews.length, 9);
    assert.equal(r.delegationFixture.runtimeHash, "0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0");
    assert.equal(r.safe.version, "1.4.1"); assert.equal(r.safe.threshold, 2);
    assert.equal(r.oneOwnerRejection.status, "reverted"); assert.equal(r.safeReplayRejection.status, "reverted");
    assert(Object.values(r.checks).every(x => x === true)); assertions += 20;
  } else if (e.kind === "wallet-claim-wallet-profile-manifest") {
    assert.equal(r.candidateCommit, index.syntheticMerge.sha); assert.equal(r.financialAuthorization, false); profile(r.compilerProfile); assertions += 8;
  } else if (e.kind === "wallet-claim-wallet-browser-evidence") {
    assert.equal(r.chainId, 31337); assert.equal(r.executionEnabled, false); assert.equal(r.status, "passed");
    assert.equal(r.sends.length, 3); assert.equal(r.layouts.length, 9);
    assert.deepEqual(r.pageErrors, []); assert.deepEqual(r.externalRequests, []);
    assert.equal(r.checks.publicProfileSigningRequested, false);
    assert.equal(r.checks.syntheticTransactionsOnly, true);
    assert.equal(r.checks.restartRecoveryDurableIndexedOriginals, true); assertions += 10;
  } else if (e.kind === "synthetic-recovery") {
    assert.equal(r.sourceCommit, index.head); assert.equal(r.status, "PASS"); assert.equal(r.checkCount, 15);
    assert.equal(r.syntheticOnly, true); assert.equal(r.productionAccess, false); assert.equal(r.originalRailwayVolumeTouched, false);
    assert.equal(r.backup.sha256, "2cdbd72d9349355b7ec04b102831b0f6964d6459f75133295c682c0814624143");
    assert.equal(r.cleanup.processStopped, true); assert.equal(r.cleanup.privateTemporaryClusterRemoved, true); assertions += 9;
  } else throw Error(`Unknown evidence kind ${e.kind}`);
  reports.push({ path: e.path, rawSha256: e.rawSha256, kind: e.kind, result: "PASS" });
}
assert.equal(index.reports.filter(r => r.kind === "creator").length, 4);
assert.equal(index.reports.filter(r => r.kind.startsWith("wallet-")).length, 6);
const result = { schemaVersion: 1, status: "PASS_RETAINED_EXACT_SOURCE_SYNTHETIC_LIFECYCLE", checkedAt: new Date().toISOString(),
  sourceHead: index.head, sourceTree: index.tree, reportsVerified: reports.length, minimumAssertions: assertions,
  firstPartySourceBindingsPerCompilerReport: 16, compiledSourcesPerCompilerReport: 66, terms, reports,
  sourceHashMethod: "UTF8 text with CRLF converted to LF, exactly as the retained fixed-supply-profile compiler helper; not Windows raw-file digest equality",
  chain31337Only: true, currentCandidateReexecutionClaimed: false, productionLifecycleClaimed: false,
  safeWebsiteCreateSupported: false, physicalIphoneAccepted: false,
  boundaries: ["The four creator reports execute the complete 2ETH economic profile; genuine delegated/Safe profile reports bind the same 66-source input.",
    "The creator fixture discovers actual 31337 receipts in the fixture namespace. Separate authenticated 4663-shaped adapter tests are not a continuous production-namespace witness.",
    "The profile runtime proof qualifies local synthetic delegated type2 and Safe beneficiary claims, not general website Safe CREATE or live phone signing.",
    "Production trade/claim HTTP execution is not implemented; changing a flag cannot activate those routes.",
    "This verifier checks stored evidence and exact current contract source bytes. Current Task091 CI and operational approval remain separate."] };
if (process.argv.length === 4 && process.argv[2] === "--output") writeFileSync(resolve(process.argv[3]), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
else if (process.argv.length !== 2) throw Error("Usage: node verify-journey.mjs [--output <fresh-json>]");
console.log(JSON.stringify({ status: result.status, reportsVerified: reports.length, minimumAssertions: assertions, sourceHead: index.head }));
