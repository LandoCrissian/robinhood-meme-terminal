"""Bind every original Task081 high to an unfiltered Task082 compiler report.

Run with the actual raw review directory outside the repository. This packages
evidence; it does not run transactions, waive detectors or certify an audit.
"""
import argparse
import collections
import gzip
import hashlib
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = pathlib.Path(__file__).resolve().parent
BASE = "4892d2af5ac09ae00975c2b799b66bec0d172779"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write(name, value):
    path = OUT / name
    assert not path.exists(), "Preserve existing evidence; use an explicit revision instead"
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8", newline="\n")


def normalized_description(text):
    # Only source relocation and the reviewed removal of the redundant private
    # payer parameter are normalized. Detector, call, balance and condition stay.
    return re.sub(r"#[0-9]+(?:-[0-9]+)?", "#SOURCE", text).replace(
        "_pay(address,address,address,uint256)", "_pay(address,address,uint256)")


def group_for(row):
    text = row["description"]
    if row["detector"] == "arbitrary-send-erc20":
        return "venue-payer"
    if row["detector"] == "arbitrary-send-eth":
        return "pinned-native-route"
    if ".fundToken(" in text:
        return "funding"
    if ".executeWithdrawal(" in text:
        if "INftAcquisition721" in text:
            return "withdraw-721"
        if "INftAcquisition1155" in text:
            return "withdraw-1155"
        return "withdraw-native" if "{value:" in text else "withdraw-token"
    if ".purchase(" in text:
        return "purchase-approval" if "t.approve" in text else "purchase-fill"
    assert "SyntheticNftListingVenueV1._pay(" in text
    return "venue-payment"


TESTS = {
    "venue-payer": ["testVenueCannotUseAnotherApprovedPayersCurrencyEvenWithValidSellerOrder",
                    "testHostileVenueCannotPullMoreThanExactERC20Approval"],
    "pinned-native-route": ["testChangedRouteCodeAndCreationPartsFailClosed",
                            "testReservedOrInsufficientFundsAreNeverSpent",
                            "testPermissionlessFillRequiresStandingPolicyAndDisableBeforeInclusionStopsIt",
                            "testHostilePinnedVenueFalseCompletionAndInterruptedFillCannotInventCustody"],
    "funding": ["testHostileCurrencyFundingAndPurchasePreserveExactBalancesAndAllowance",
                "testTokenFundingAndPurchaseApprovalCallbacksCannotMutateVaultState"],
    "purchase-approval": ["testTokenFundingAndPurchaseApprovalCallbacksCannotMutateVaultState",
                          "testHostileVenueCannotPullMoreThanExactERC20Approval"],
    "purchase-fill": ["testSuccessfulNftCallbackDoesNotSubstituteForExactSellerAndVaultBalances",
                      "testWrongCustodyReceiverAndInterruptedTransferRollBackPaymentsAndOrder",
                      "testMaliciousNftCallbackIsStoppedByExactReentrancyGuard",
                      "testRoyaltyCallbackCannotExecuteAnotherAlreadyMatureAssetNotice"],
    "venue-payment": ["testRoyaltyCallbackCannotReenterVenueAndInvalidateAnUnrelatedSellerNonce",
                      "testRecipientForwardingNativePayoutCannotDefeatExactBalanceBaseline",
                      "testVenueCannotUseAnotherApprovedPayersCurrencyEvenWithValidSellerOrder"],
    "withdraw-native": ["testAssetWithdrawalCallbackCannotConsumeAnotherMatureNotice",
                        "testNoticedAssetWithdrawalReservationExpiryAndRejectedPayout"],
    "withdraw-token": ["testTokenWithdrawalCallbackCannotMutateOtherNoticeOrReservation",
                       "testTokenWithdrawalExactDeltasAndNoticeSurviveHostileReturnBehavior"],
    "withdraw-721": ["test721ForwardingReceiverCannotTurnNoticedCustodyIntoDifferentFinalOwnership",
                     "testAcquiredNftNeedsSeparateTwoDayWithdrawalAndCannotBeSwept"],
    "withdraw-1155": ["test1155ForwardingReceiverCannotTurnNoticedCustodyIntoDifferentFinalOwnership"],
}

PRECONDITIONS = {
    "venue-payer": "An attacker has a valid seller order and some other account has approved the venue; exploiting the warning would require choosing that account as payer while calling fill from a different address.",
    "pinned-native-route": "A current standing policy admits this exact collection, ID/quantity, currency, all-in cost, time and epochs, and settled unreserved capital covers it. A caller can trigger the purchase without being controller, but cannot change its immutable venue or signed consideration.",
    "funding": "The current admissible controller authorizes funding and approves the immutable payment token; callback behavior comes from that exact pinned token runtime.",
    "purchase-approval": "An enabled standing policy and a valid signed order reach the pinned ERC20 approval. The token or downstream venue attempts a callback or a debit larger than the exact all-in allowance.",
    "purchase-fill": "A valid signed order is admitted by the current standing policy. An admitted NFT, token or signed consideration recipient attempts a callback or misleading delivery while the exact pinned venue executes.",
    "venue-payment": "A valid seller signature, current seller nonce and open order reach consideration settlement. A native recipient or immutable selected ERC20 attempts callback behavior during a payout.",
    "withdraw-native": "A current-epoch exact recipient/amount notice has completed its two-day delay and is within its finite window. The native recipient attempts another already-mature withdrawal during its receipt callback.",
    "withdraw-token": "A current-epoch exact ERC20 recipient/amount notice is mature. The pinned token attempts another state-changing entry or returns malformed/incorrect settlement.",
    "withdraw-721": "A current-epoch exact NFT/ID/recipient notice is mature. The recipient's safe-receive callback forwards the NFT or attempts another state-changing entry.",
    "withdraw-1155": "A current-epoch exact NFT/ID/quantity/recipient notice is mature. The recipient's safe-receive callback forwards inventory or attempts another state-changing entry.",
}

BOUNDARIES = {
    "venue-payer": "fill first requires msg.sender == order.vault. The revised private _pay derives from = msg.sender itself; no private helper argument can select a third-party payer. transferFrom can therefore consume only the caller vault's exact approval.",
    "pinned-native-route": "The only value-bearing purchase call targets the immutable venue, checks its runtime, and invokes typed fill. No order, URL or caller-supplied calldata selects the call target. Current policy, available reserves, cooldown and epochs limit the amount; exact NFT/payment postconditions and the guard constrain completion.",
    "funding": "onlyController precedes the guarded body; supported-account queries are view/static calls. The guard sets entered before transferFrom. Funding credits roll back unless the exact sender debit and vault credit both equal amount.",
    "purchase-approval": "The guard is active before approval. Allowance must start at zero, equal exactly the signed all-in total after approve, and be zero after fill. Post-fill actual currency debit and both NFT endpoints/owner are checked against the intentional before snapshots.",
    "purchase-fill": "Order consumption, accounted debit, lifetime/period spend and cooldown update under the guard before fill. The sole admitted receive callback can set received, but cannot substitute for actual seller/vault NFT deltas, ownerOf, currency debit, filled status or code hashes. Any mismatch rolls everything back.",
    "venue-payment": "The venue enters its own reentrancy lock before checking signature/counter/order state and before every payout. State becomes filled before external effects, but any failed endpoint delta or NFT delivery reverts all earlier effects. Native recipient delta is exact; ERC20 source and destination deltas are exact.",
    "withdraw-native": "The guard is active and the exact immutable notice is consumed and its reservation released before sending. Both native endpoints must match the intentional snapshots. Reentry cannot consume a second notice. A callback that spends its received ETH can cause an atomic rejection, not a retained partial payout.",
    "withdraw-token": "The guard is active before the exact notice is consumed/reservation released and token transfer begins. Both actual token endpoints are checked against snapshots; a malformed return or callback cannot leave a consumed notice or partial accounting after revert.",
    "withdraw-721": "The guard is active before transfer and recorded held inventory is decremented. Both collection balance endpoints and final ownerOf must match the exact noticed recipient. Callback forwarding causes a full rollback, including reservation and notice state.",
    "withdraw-1155": "The guard is active before transfer and held inventory is decremented. Both exact-ID balance endpoints must change by the exact noticed quantity. Callback forwarding causes a full rollback, including reservation and notice state.",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", required=True, type=pathlib.Path)
    parser.add_argument("--scan", required=True, type=pathlib.Path)
    args = parser.parse_args()
    raw = args.raw.resolve()
    assert not raw.is_relative_to(ROOT)
    before_path = ROOT / "docs/evidence/rmt-task081/security/high-findings.json"
    before = json.loads(before_path.read_text())
    report_bytes = (raw / "nft-acquisition-slither.json").read_bytes()
    report = json.loads(report_bytes)
    compiler_bytes = (raw / "nft-acquisition-hardened-manifest.json").read_bytes()
    compiler = json.loads(compiler_bytes)
    standard = (raw / "nft-acquisition-hardened.json").read_bytes()
    ast_bytes = (raw / "ast-boundaries.json").read_bytes()
    ast = json.loads(ast_bytes)
    assert before["highs"] == 23 and len(before["findings"]) == 23
    assert report["detectorCount"] == 101 and report["sources"] == 5
    assert report["tool"] == "Slither 0.11.5" and report["cryticCompile"] == "0.3.11"
    assert report["inputSha256"] == compiler["inputSha256"] == ast["inputSha256"] == sha(standard)
    highs = [f for f in report["detectors"] if f["impact"] == "High"]
    rows = []
    for original in before["findings"]:
        group = group_for(original)
        matches = [f for f in highs if f["id"] == original["id"]]
        if not matches:
            matches = [f for f in highs if normalized_description(f["description"]) == normalized_description(original["description"])]
        assert len(matches) <= 1
        removed = group == "venue-payer"
        assert bool(matches) != removed, "Unexpected finding deletion or unmatched replacement"
        source = re.search(r"\((nft-acquisition/src/[^#]+)#([0-9]+)(?:-([0-9]+))?\)", original["description"])
        call = re.search(r"External call allowing reentrancy:\n\t- (.+)", original["description"])
        baseline = re.search(r"Balance read before the call:\n\t- (.+)", original["description"])
        exposed = "Exact source/destination ERC20 debit/credit" if group == "venue-payer" else "Settled native capital and signed NFT consideration" if group == "pinned-native-route" else "Actual currency reserve baseline" if baseline and "oldCurrency" in baseline[1] else "NFT seller inventory baseline" if baseline and "oldSeller" in baseline[1] else "NFT vault custody baseline" if baseline and "oldHeld" in baseline[1] else "Exact asset endpoint baseline and its corresponding reservation/accounting"
        tests = list(dict.fromkeys(original["tests"] + TESTS[group]))
        test_sources = "\n".join(p.read_text() for p in (ROOT / "packages/contracts/nft-acquisition/test").rglob("*.sol"))
        assert all("function " + test + "(" in test_sources for test in tests)
        rows.append({
            "originalId": original["id"], "detector": original["detector"],
            "originalImpact": "High", "originalConfidence": original["confidence"],
            "source": {"path": "packages/contracts/" + source[1], "firstLine": int(source[2]), "lastLine": int(source[3] or source[2]), "basis": "Original Task081 source, not rewritten current line numbers"},
            "functionAndOriginalDescription": original["description"],
            "root": group, "externalCall": call[1] if call else "t.transferFrom(from,to,amount)" if removed else "INftAcquisitionVenue(venue).fill{value:total}(order,signature)",
            "observedBalance": baseline[1] if baseline else None,
            "assetOrAuthorityAtRisk": exposed, "preconditions": PRECONDITIONS[group],
            "possibleReentrantOrMisusePath": "External callback -> a second purchase/withdrawal/funding/policy mutation while entered==2; or replacing a valid endpoint delta with a callback/fake fill flag. A path would require defeating the active guard or trusted source/route assumptions." if not removed else "Caller attempts to name an independently approved third-party payer; fill's caller binding rejects it, and revised _pay no longer exposes any payer parameter.",
            "stateAndSafeguards": BOUNDARIES[group],
            "minimalAdversarialCases": tests,
            "newTestsExecutedLocally": False, "localTestEvidence": "Pinned-solc ABI/AST typecheck: nine source/test files, zero errors and warnings. Foundry EVM execution is separately required in Linux CI.",
            "assessment": "CONSERVATIVE_BASELINE_CAPABILITY_OBSERVATION_WITH_NARROW_PAYER_HARDENING" if removed else "INTERNALLY_ASSESSED_CONSERVATIVE_BALANCE_OR_FIXED_ROUTE_OBSERVATION_UNCLEARED",
            "confirmedReachableAssetLossIdentified": False, "independentSecurityClearance": False,
            "mitigation": "Removed redundant private from argument and derived the payer from msg.sender; all exact balance, signature, order and custody assertions are unchanged. This eliminates this detector row in the actual new all-detector scan, not proof of a baseline loss exploit." if removed else "Retain the exact endpoint/ownership assertions, reentrancy lock and runtime/authority/notice gates. Strengthened local hostile callback, forwarding, bounded approval and interruption tests; no assertion or detector suppression.",
            "currentObservation": {"id": matches[0]["id"], "impact": matches[0]["impact"], "check": matches[0]["check"], "description": matches[0]["description"]} if matches else None,
            "currentStrictGateCleared": False,
            "remainingUncertainty": "Finite tests are not an independent audit or proof for arbitrary assets or future adapters. Runtime hashing is identity, not semantic safety: source/implementation/proxy/admin behavior must be admitted separately. Native receivers that forward/spend during receipt and NFT receivers that immediately forward deliberately fail exact final-balance/custody requirements. The chain31337 synthetic route remains nondeployable on4663; no Seaport spending is approved.",
        })
    assert len({row["originalId"] for row in rows}) == 23
    assert {row["currentObservation"]["id"] for row in rows if row["currentObservation"]} == {f["id"] for f in highs}
    scan = args.scan.read_bytes()
    assert json.loads(scan) == [], "Do not compress unclassified raw findings"
    files = []
    for name, content in [("compiler-input.json.gz", standard), ("compiler-manifest-windows.json.gz", compiler_bytes),
                          ("slither-windows.json.gz", report_bytes), ("ast-boundaries.json.gz", ast_bytes),
                          ("slither-windows-log.txt.gz", (raw / "nft-acquisition-slither.log").read_bytes())]:
        path = OUT / name
        assert not path.exists()
        compressed = gzip.compress(content, mtime=0)
        path.write_bytes(compressed)
        files.append({"path": name, "bytes": len(compressed), "sha256": sha(compressed), "uncompressedBytes": len(content), "uncompressedSha256": sha(content)})
    report_counts = dict(collections.Counter(f["impact"] for f in report["detectors"]))
    write("findings.json", {"schemaVersion": 1, "status": "BLOCKED_NO_BROADCAST", "baselineCommit": BASE,
                           "reviewedSourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip(),
                           "beforeInputSha256": before["compilerInputSha256"], "afterInputSha256": compiler["inputSha256"],
                           "originalRows": 23, "currentHighs": len(highs), "currentStrictExit": 1,
                           "allDetectors": 101, "detectorFilters": [], "sourceFilters": [], "severityOverrides": [],
                           "confirmedDefectCount": 0, "independentAudit": False, "rows": rows})
    write("local-analysis.json", {"schemaVersion": 1, "status": "TEST_EXECUTION_PENDING_STRICT_ANALYSIS_FAILED",
                                 "scope": "LOCAL_PINNED_WINDOWS_COMPILER_AND_SLITHER_NOT_EVM_EXECUTION",
                                 "compilerInputSha256": compiler["inputSha256"], "sourceCount": 5,
                                 "detectors": 101, "tool": report["tool"], "cryticCompile": report["cryticCompile"],
                                 "compilerExecutableSha256": report["compilerSha256"], "counts": report_counts,
                                 "strictExit": 1, "beforeHighs": 23, "afterHighs": len(highs),
                                 "removedPaymentCapabilityRows": 1, "retainedBalanceRows": 21, "retainedFixedNativeRouteRows": 1,
                                 "independentAudit": False, "productionEnabled": False, "testsTypechecked": {"sourceFiles": 9, "errors": 0, "warnings": 0, "EvmExecution": False},
                                 "rawSecretScan": {"version": "8.30.1", "configurationSha256": sha((ROOT / ".gitleaks.toml").read_bytes()), "findings": 0, "exit": 0, "rawReportSha256": sha(scan), "rawBeforeCompression": True},
                                 "files": files, "templates": compiler["templates"]})


if __name__ == "__main__":
    main()
