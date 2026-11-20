"""Check all22stage dispositions, exact sources and freshly rerun expression proofs offline."""
import contextlib
from collections import Counter
import gzip
import hashlib
import importlib.util
import importlib.metadata
import io
import json
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
def read(path):return json.loads(path.read_text())
def sha(data):return hashlib.sha256(data).hexdigest()
def require(ok,message):
 if not ok:raise ValueError(message)
old=read(ROOT/"docs/evidence/rmt-task088b/security/finding-matrix.json")
new=read(HERE/"stage-dispositions.json")
raw=gzip.decompress((ROOT/"docs/evidence/rmt-task088b/security/fixed-supply-4663.json.gz").read_bytes())
require(sha(raw)==new["compilerInputSha256"]==old["inputSha256"],"compiler input identity changed")
sources=json.loads(raw)["sources"]
report=json.loads(gzip.decompress((ROOT/"docs/evidence/rmt-task088b/security/slither-4663.json.gz").read_bytes()))
highs={a["id"]:a for a in report["detectors"] if a["impact"]=="High"}
require(len(highs)==22 and len(report["detectors"])==233 and report["detectorCount"]==101,"raw findings/detectors changed")
require(new["strictRawHighCount"]==22 and new["strictRawScannerExit"]==1 and new["strictGateUnchanged"] is True,"strict result changed")
require(new["financialGate"]=="BLOCKED_NO_BROADCAST" and not new["contractChanges"] and not new["economicChanges"],"unauthorized clearance/change")
rows=new["findings"];ids=[a["id"] for a in rows];require(len(ids)==len(set(ids))==22 and set(ids)==set(highs)=={a["id"] for a in old["findings"]},"missing/duplicate/unknown High finding")
prior={a["id"]:a for a in old["findings"]}
for a in rows:
 b=prior[a["id"]]
 require(a["check"]==b["detector"] and a["rawSeverity"]==b["impact"]=="High" and a["group"]==b["group"],"finding identity changed")
 require(a["affectedFunction"]==b["sources"][0]["function"] and a["path"]==b["sources"][0]["path"] and a["flaggedLine"]==b["flaggedLine"],"source mapping changed")
 require(a["sourcePins"]==b["sources"],"source pins changed")
 require(a["existingTests"]["names"]==b["existingSyntheticTestNames"],"supporting test binding changed")
 require(not a["rawScannerGateChanged"] and not a["financialActivationAuthorized"],"finding gate/authorization changed")
 require(not a["directDirectoryPublicationExposure"] and not a["directTokenCreationExposure"],"stage boundary changed")
 require(all(a[k] for k in ["firstEnabledStage","directAffectedStages","proofOrUnresolvedReason","requiredClosure","publicationConsequence"]),"incomplete owner row")
 require(a["priorTask088Disposition"]=="REPRODUCED_HIGH_STRICT_GATE_UNCLEARED" and a["priorInternalMetadata"]=="PINNED_FALSE_POSITIVE","historical metadata conflated")
 expected="INDEPENDENTLY_DISPROVEN_EXACT_IMMUTABLE_EXPRESSION" if b["group"].startswith("dependency-") else "UNRESOLVED"
 require(a["disposition"]==expected,"unsupported disposition")
counts=Counter(a["disposition"] for a in rows)
require(counts=={"INDEPENDENTLY_DISPROVEN_EXACT_IMMUTABLE_EXPRESSION":4,"UNRESOLVED":18},"disposition counts differ")
require(new["classificationCounts"]=={"CONFIRMED_EXPLOIT":0,"INDEPENDENTLY_DISPROVEN_EXACT_IMMUTABLE_EXPRESSION":4,"UNRESOLVED":18},"count summary differs")
bindings=read(HERE/"core-stage-bindings.json")
for pin in bindings["sourcePins"]:
 require(sha((ROOT/pin["path"]).read_bytes())==pin["originalSha256"],"current first-party source changed")
 archive_path=pin["path"].removeprefix("packages/contracts/")
 require(sha(sources[archive_path]["content"].encode())==pin["review4663SourceSha256"],"review source changed")
terms=read(ROOT/"docs/evidence/fixed-supply-security/4663-profile.json")["terms"]
require(terms=={"fixedSupplyWei":"1000000000000000000000000000","decimals":18,"curveInventoryWei":"600000000000000000000000000","initialLiquidityInventoryWei":"400000000000000000000000000","creationFeeWei":"400000000000000","graduationBackingWei":"2000000000000000000","tradingFeeBps":100,"projectBps":9000,"operationsBps":500,"reserveBps":500},"retained production economic terms changed")
require(str(terms["creationFeeWei"])==bindings["feeAndEconomics"]["creationFeeWei"]=="400000000000000","creation fee changed")
require("GRADUATION_BACKING = 2 ether;" in sources["src/RMTLaunchCurveMathV1.sol"]["content"],"4663graduation backing changed")
require("VIRTUAL_ETH = 4 ether;" in sources["src/RMTLaunchCurveMathV1.sol"]["content"],"4663virtual reserve changed")
spec=importlib.util.spec_from_file_location("proof",HERE/"prove-arithmetic.py")
proof=importlib.util.module_from_spec(spec);spec.loader.exec_module(proof)
with contextlib.redirect_stdout(io.StringIO()):fresh=proof.run()
identity_spec=importlib.util.spec_from_file_location("identity",HERE/"proof-result-identity.py")
identity=importlib.util.module_from_spec(identity_spec);identity_spec.loader.exec_module(identity)
tools=read(HERE/"proof-tool-manifest.json")
require(importlib.metadata.version("z3-solver")==tools["version"]=="4.13.4.0","proof solver package version changed")
require(tools["capturedProofEnvironment"]["z3Version"]==fresh["z3Version"],"captured solver provenance changed")
require(sys.implementation.name=="cpython" and tools["capturedProofEnvironment"]["implementation"]=="CPython","unsupported Python implementation provenance")
environment=identity.compare_proof_results(read(HERE/"arithmetic-proof-result.json"),fresh,captured_python_version=tools["capturedProofEnvironment"]["pythonVersion"],runtime_python_version=sys.version.split()[0])
for row in rows:
 if row["disposition"].startswith("INDEPENDENTLY"):
  key=row["newEvidence"]["proofKey"];require(fresh[key]["result"]=="PROVED","expression proof absent")
for name,key,field in [("lsb-isolation.smt2","lsb","isolationQuerySha256"),("fullmath-seed.smt2","fullMathInverse","seedQuerySha256"),("openzeppelin-seed.smt2","openZeppelinInverse","seedQuerySha256")]:
 require(sha((HERE/name).read_bytes())==fresh[key][field],"retained SMT query changed")
print(json.dumps({"result":"PASS","highRows":22,"confirmedExploit":0,"independentlyDisprovenReportedExpressions":4,"unresolvedStatefulFindings":18,"sourcePins":len(bindings["sourcePins"]),"rawDetectors":101,"rawFindings":233,"rawHigh":22,"rawStrictExit":1,"gate":"BLOCKED_NO_BROADCAST","proofEnvironment":environment}))
