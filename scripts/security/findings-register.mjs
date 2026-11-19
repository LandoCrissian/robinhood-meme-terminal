import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";

const repository=fileURLToPath(new URL("../../",import.meta.url));
export const registerPath="docs/evidence/rmt-task080/findings-register.json";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const lf=bytes=>Buffer.from(bytes.toString("utf8").replaceAll("\r\n","\n"));
const readFile=path=>readFileSync(resolve(repository,path));
const order=(a,b)=>a<b?-1:a>b?1:0;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>order(a,b)).map(([key,item])=>[key,canonical(item)])):value;
const stringify=value=>JSON.stringify(canonical(value));
const severities=["High","Medium","Low","Informational","Optimization"];
const counts=rows=>Object.fromEntries(severities.map(severity=>[severity,rows.filter(row=>row.impact===severity).length]));
const sourcePath=path=>{assert.equal(typeof path,"string");const result=path.replace(/^packages\/contracts\//,"");assert.ok(!result.includes("..")&&!result.includes("\\")&&!result.startsWith("/")&&!result.includes(":"),"Noncanonical source path");return result;};

/** Exact detector IDs are scoped to the actual analysis input. Similar warning
 * descriptions or shared root-cause families are never a deduplication key. */
export function deduplicateRows(analysisInputSha256,rows){
  assert.match(analysisInputSha256,/^[a-f0-9]{64}$/);const found=new Map();
  for(const row of rows){assert.match(row.id,/^[a-f0-9]{64}$/);assert.equal(typeof row.check,"string");assert.ok(row.check.length>0&&severities.includes(row.impact));
    const id=`${analysisInputSha256}:${row.check}:${row.id}`,old=found.get(id);
    assert.ok(!old||stringify(old)===stringify(row),"Conflicting content for the same analysis-scoped detector ID");if(!old)found.set(id,row);
  }
  return[...found].map(([key,row])=>({key,row}));
}

const definitions=[
  {id:"core-and-dependencies-4663",state:"ACTIVE_DEPLOYMENT_PINNED_CORE",report:"docs/evidence/fixed-supply-security/slither-4663.json.gz",manifest:"docs/evidence/fixed-supply-security/4663-profile.json",disposition:"docs/evidence/fixed-supply-security/task063-findings.json",expected:{High:22,Medium:60,Low:39,Informational:110,Optimization:2},high:22},
  {id:"project-treasury-v1",state:"ACTIVE_OPTIONAL_PREDEPLOYMENT_TREASURY",report:"docs/evidence/rmt-task077/security/slither-v1-reproduced.json.gz",manifest:"docs/evidence/rmt-task076/compiler-manifest.json",input:"docs/evidence/rmt-task076/compiler-input.json.gz",disposition:"docs/evidence/rmt-task077/security/disposition.json",expected:{High:6,Medium:4,Low:10,Informational:5,Optimization:0},high:6},
  {id:"reclaim-v1-rejected",state:"REJECTED_HISTORICAL_REVERSIBLE_MODEL",report:"docs/evidence/rmt-task078/security/slither-current.json.gz",manifest:"docs/evidence/rmt-task078/compiler-manifest.json",input:"docs/evidence/rmt-task078/security/compiler-current.json.gz",disposition:"docs/evidence/rmt-task078/security/disposition.json",expected:{High:4,Medium:1,Low:18,Informational:4,Optimization:1},high:4},
  {id:"reclaim-v2-permanent-trial",state:"ACTIVE_DEVELOPMENT_TRIAL_PRODUCTION_DISABLED",report:"docs/evidence/rmt-task079/security/slither-final.json.gz",manifest:"docs/evidence/rmt-task079/security/compiler-manifest.json",input:"docs/evidence/rmt-task079/security/compiler-final.json.gz",disposition:"docs/evidence/rmt-task079/security/disposition.json",expected:{High:7,Medium:1,Low:29,Informational:7,Optimization:1},high:7},
  {id:"treasury-v2-nonspending-prototype",state:"NONEXECUTING_NO_CUSTODY_PROTOTYPE",report:"docs/evidence/rmt-task077/security/slither-v2-prototype.json.gz",manifest:"docs/evidence/rmt-task077/compiler-manifest.json",input:"docs/evidence/rmt-task077/compiler-input.json.gz",disposition:"docs/evidence/rmt-task077/security/disposition.json",expected:{High:0,Medium:0,Low:2,Informational:1,Optimization:0},high:0},
];

const coreTests={
  "position-funding":["testPositionManagerFundingCallbackCannotReenterOrReadTransientFees","testPositionManagerCorruptFundingRollsBackEveryBalanceAndCanRetry","testSharedUnlockRejectsNestedGraduationAndPrefundedBalancesAreExcluded"],
  "curve-graduation":["testOverfillRefundAndPermissionlessGraduationWithAtomicRetries","testGraduationRejectsFakeApprovalGrantOrRevocation","testGraduationRejectsForcedRefundEvenWhenNativeBalanceMatches"],
  "lp-harvest":["testPositionManagerHarvestRejectsReentryFeeDiversionAndPrincipalChange","testSharedUnlockCannotHarvestOrAlterOriginalPosition"],
  "asset-bearing-migration":["testHistoricalMixedRouteAndNewCandidateCallbackBarrier","testFundedAcceptanceHidesBothRoutesAndLateRotationRollsBackAssetsAndAuthority","testGovernedV2ToV3MigrationRollsBackOnFailedAcceptanceThenRetries"],
  "dependency-muldiv":["testExactWideQuotientsForAllOddDenominatorClasses","testFuzzExactQuotientAgainstIndependentWideProduct","testDivisorAndQuotientBoundariesRevert"],
  "dependency-bit-index":["testBitIndicesCoverEveryOneHotAndDenseBoundary","testFuzzBitIndicesAgainstSimpleScan","testZeroInputIsOutsideBitIndexDomain"],
};
const coreTestFiles=["RMTV4CurveGraduationV1.t.sol","RMTV4SharedPoolSettlement.t.sol","RMTLaunchBondingCurveV1.t.sol","RMTLaunchMigrationReadiness.t.sol","RMTLaunchProjectRegistryV3.t.sol","RMTLaunchCurveDirectoryV2.t.sol","RMTDependencyArithmeticReview.t.sol"].map(file=>"packages/contracts/test/"+file);
const governanceTests={
  execute:["testOrdinaryExecutionUsesExactDigestWithInclusiveExpiry","testRotationInvalidatesPendingPublicationAndReaddedKeyCannotReplay"],
  cancel:["testOrdinaryExecutionAndCancellationHonorOnlyFirstInclusion"],
  clearExpired:["testOrdinaryExecutionUsesExactDigestWithInclusiveExpiry"],
  executeSignerRotation:["testIncomingSignerMustAcceptExactActionAndBeEligible","testIncomingAccountTypeIsRecheckedAtExecution","testRotationSignaturesBindChainAndDirectory"],
  cancelSignerRotation:["testStaleEpochCancellationCannotCancelAfterSignerIsReadded","testRotationExecutionAndCancellationHonorOnlyFirstInclusion"],
  clearExpiredRotation:["testCancellationAndExpiryConsumeRotationNonceWithoutEpochChange"],
  executeMigration:["testHistoricalMixedRouteAndNewCandidateCallbackBarrier","testFundedAcceptanceHidesBothRoutesAndLateRotationRollsBackAssetsAndAuthority"],
};
const coreFunds={
  "position-funding":"Graduating ETH/token deposits, funded position ownership and locked original LP principal.",
  "curve-graduation":"Actual ETH backing, unsold token inventory, narrow approvals and atomic graduation/refunds.",
  "lp-harvest":"Earned original-position ETH/ERC20 fees; principal must never decrease or be redirected.",
  "asset-bearing-migration":"Existing token identity, ETH backing, unsold inventory, writer routing and accrued fee entitlements.",
  "dependency-muldiv":"Amount/liquidity arithmetic in containing runtime-pinned dependencies if the flagged arithmetic semantics were wrong.",
  "dependency-bit-index":"Pool bitmap/bit-index arithmetic in containing runtime-pinned dependencies if the flagged shift semantics were wrong.",
};

export function buildFindingsRegister({read=readFile}={}){
  const inputFiles=new Map(),load=path=>{const bytes=read(path);inputFiles.set(path,{path,normalization:path.endsWith(".gz")?"binary":"canonical-lf",sha256:sha(path.endsWith(".gz")?bytes:lf(bytes))});return bytes;};
  const json=path=>JSON.parse(path.endsWith(".gz")?gunzipSync(load(path),{maxOutputLength:32*1024*1024}):load(path).toString("utf8"));
  const checkReference=reference=>{const[file,name]=reference.split("::");const bytes=load(file);if(name)assert.match(bytes.toString("utf8"),new RegExp("\\bfunction\\s+"+name+"\\s*\\("),"Recorded regression function is missing: "+reference);return reference;};
  const namedTests=(names,files)=>names.map(name=>{const file=files.find(path=>new RegExp("\\bfunction\\s+"+name+"\\s*\\(").test(load(path).toString("utf8")));assert.ok(file,"Recorded regression name is missing: "+name);return checkReference(file+"::"+name);});
  const scopes=[],findings=[],rawFindingIndex=[];
  for(const definition of definitions){
    const reportBytes=load(definition.report),raw=gunzipSync(reportBytes,{maxOutputLength:32*1024*1024}),report=JSON.parse(raw),manifest=json(definition.manifest),disposition=json(definition.disposition);
    assert.equal(report.tool,"Slither 0.11.5");assert.equal(report.cryticCompile,"0.3.11");assert.equal(report.detectorCount,101);assert.equal(report.inputSha256,manifest.inputSha256);assert.equal(report.sources,manifest.sourceCount??manifest.sourceSha256.length);
    assert.match(report.analysisInputSha256,/^[a-f0-9]{64}$/);assert.equal(report.compilerSha256,manifest.executableSha256);assert.deepEqual(counts(report.detectors),definition.expected,"Retained raw result counts changed: "+definition.id);
    if(definition.input)assert.equal(sha(gunzipSync(load(definition.input))),report.inputSha256,"Exact archived compiler input mismatch");
    if(definition.id==="core-and-dependencies-4663"){assert.equal(sha(reportBytes),disposition.rawAnalysis.sha256);assert.equal(report.inputSha256,disposition.inputSha256);}
    if(definition.id==="project-treasury-v1")assert.equal(sha(raw),disposition.v1.rawSha256);
    if(definition.id==="treasury-v2-nonspending-prototype")assert.equal(sha(raw),disposition.v2Prototype.rawSha256);
    if(definition.id==="reclaim-v1-rejected"){assert.equal(sha(reportBytes),disposition.current.reportSha256);assert.equal(sha(raw),disposition.current.rawReportSha256);}
    if(definition.id==="reclaim-v2-permanent-trial"){const anchor=disposition.snapshots.find(row=>row.name==="final");assert.equal(sha(raw),anchor.reportSha256);assert.equal(report.inputSha256,anchor.inputSha256);assert.deepEqual(disposition.detectorFilters,[]);assert.deepEqual(disposition.sourceFilters,[]);}
    const compiledPins=new Map(manifest.sourceSha256.map(([path,hash])=>[sourcePath(path),hash])),originalPins=new Map([...compiledPins,...(manifest.originalSourceSha256??[]).map(([path,hash])=>[sourcePath(path),hash])]);
    for(const[path,expected]of originalPins)assert.equal(sha(lf(load("packages/contracts/"+path))),expected,"Pinned source changed: "+path);
    const unique=deduplicateRows(report.analysisInputSha256,report.detectors),detailedBefore=findings.length;
    const priorRows=definition.id==="core-and-dependencies-4663"?disposition.findings:definition.id==="project-treasury-v1"?disposition.v1.rows:definition.id==="reclaim-v1-rejected"?disposition.rows:definition.id==="reclaim-v2-permanent-trial"?disposition.currentV2.findings:disposition.v2Prototype.observations;
    const prior=new Map(priorRows.map(row=>[row.id,row]));assert.equal(prior.size,priorRows.length,"Duplicate disposition IDs");
    for(const{key,row}of unique){
      const selected=row.impact==="High"||definition.id==="treasury-v2-nonspending-prototype"||definition.id==="core-and-dependencies-4663"&&prior.has(row.id);
      rawFindingIndex.push({scopeId:definition.id,analysisInputSha256:report.analysisInputSha256,detector:row.check,findingId:row.id,severity:row.impact,detailed:selected});
      if(!selected)continue;
      const inherited=prior.get(row.id);assert.ok(inherited,"No prior disposition for selected raw finding: "+row.id);assert.equal(inherited.detector??inherited.check,row.check);assert.equal(inherited.impact??inherited.severity,row.impact);
      const sourceLocations=row.elements.filter(element=>element.type==="function"||element.type==="node").map(element=>{
        const path=sourcePath(element.source_mapping.filename_short);assert.ok(compiledPins.has(path),"Finding source escapes its compiler closure: "+path);
        return{kind:element.type,role:element.additional_fields?.underlying_type??(element.type==="function"?"affected-function":"observation"),name:element.name,path:"packages/contracts/"+path,firstLine:element.source_mapping.lines[0],lastLine:element.source_mapping.lines.at(-1),compiledSourceSha256Lf:compiledPins.get(path),repositorySourceSha256Lf:originalPins.get(path)};
      });
      const contracts=new Set(row.elements.filter(element=>element.type==="function").map(element=>element.type_specific_fields?.parent?.name));
      const templates=Object.entries(manifest.templates??{}).filter(([name])=>contracts.has(name)).map(([name,data])=>({contract:name,...data}));
      let group,assessment,reachability,fundsAtRisk,preconditions,mitigations,tests,remainingUncertainty,ownerDecision;
      if(definition.id==="core-and-dependencies-4663"){
        group=inherited.group;assessment={status:"INTERNAL_PINNED_PATH_ASSESSMENT_NOT_INDEPENDENT_CLEARANCE",inheritedDisposition:inherited.disposition,rationale:inherited.rationale};reachability=inherited.reachability;
        fundsAtRisk=coreFunds[group]??"Governance runtime admission, signer continuity and authorized project migration routes; no new custody authority is inferred.";
        preconditions=[inherited.residualRisk];mitigations=[inherited.rationale];
        const names=coreTests[group]??governanceTests[row.elements.find(element=>element.type==="function")?.name]??[...inherited.rationale.matchAll(/\b(test[A-Z][A-Za-z0-9_]*)\b/g)].map(match=>match[1]);
        assert.ok(names.length,"Selected governance finding lacks a named regression");tests=namedTests([...new Set(names)],coreTestFiles);
        remainingUncertainty=inherited.residualRisk;ownerDecision="Exact-candidate and affected-stage risk decision remains separate from transaction authorization; confirmed high-impact vulnerabilities or unresolved plausible material loss paths must be resolved before that stage. Paid audit procurement is not required by this register.";
      }else if(definition.id==="project-treasury-v1"){
        group=inherited.function;assessment={status:inherited.disposition,confirmedDefect:inherited.confirmedDefect,cleared:inherited.cleared,rationale:inherited.concern};reachability="REACHABLE_CUSTODY_OR_CLAIM_BOUNDARY_IN_OPTIONAL_UNDEPLOYED_V1";
        fundsAtRisk=group==="claimLp"?"Project's independently settled ETH/ERC20 fee credits and exact treasury receipt accounting; locked original LP principal remains excluded.":"Project treasury token deposits, reserved withdrawal balances and exact beneficiary transfers.";
        preconditions=inherited.preconditions;mitigations=["Exact registered TokenV2/ledger/graduation pins, campaign mutation guards and before/after sender/recipient balance assertions remain mandatory.",inherited.concern];tests=[checkReference(inherited.test)];remainingUncertainty=inherited.remainingUncertainty;
        ownerDecision="No optional treasury custody/purchase release from these six internally disputed warnings. Any revised version needs exact new bytecode, beneficiary continuity and approval; no paid-review requirement is invented.";
      }else if(definition.id==="reclaim-v1-rejected"){
        group=inherited.function;assessment={status:"REJECTED_HISTORICAL_ONLY",inheritedDisposition:inherited.disposition,cleared:false,rationale:"The entire reversible escrow product was rejected by the owner's permanent-surrender correction. Historical tests do not approve a return/repayment path."};reachability="NOT_REACHABLE_FROM_ACTIVE_RECLAIM_V2_IMPORT_OR_DEPLOYMENT_GRAPH";
        fundsAtRisk="Historical experimental reward reserves and reversibly escrowed NFTs if this rejected bytecode were ever deployed; no approved real V1 campaign exists.";
        preconditions=inherited.preconditions;mitigations=["V1 source/report are retained as rejected history; active V2 uses separately versioned factories, ABI, runtime/materialization and indexing tables.",inherited.remediation];tests=[checkReference(inherited.test),checkReference(inherited.callbackTest)];remainingUncertainty=inherited.remainingUncertainty;
        ownerDecision="No activation of this rejected product. Preserve historical evidence; returning NFTs, repayment and NFT withdrawal are not an available approval shortcut.";
      }else if(definition.id==="reclaim-v2-permanent-trial"){
        group=/\._(\w+)\(/.exec(inherited.functionAndSource)?.[1]??"permanent-retirement";assessment={status:inherited.classification,cleared:inherited.cleared,rationale:inherited.potentialReentry};reachability="REACHABLE_TRIAL_REWARD_OR_RETIREMENT_BOUNDARY_WHEN_VALID_LOCAL_POLICY_IS_CONFIGURED";
        fundsAtRisk=inherited.protectedAssets;preconditions=[inherited.assumptions];mitigations=[inherited.stateTransition,inherited.potentialReentry,inherited.invariant];tests=namedTests(inherited.tests,["packages/contracts/reclaim-v2/test/RMTReclaimV2.t.sol","packages/contracts/reclaim-v2/test/RMTReclaimV2Invariant.t.sol"]);remainingUncertainty=inherited.uncertainty;
        ownerDecision="Reclaim remains a frozen trial candidate. Real RMT identity, source-reviewed irreversible collection profiles, authorized controller, manual funding, security disposition and activation all remain unapproved. No genuine material loss path may be waived.";
      }else{
        group="nonspending-quote-policy";assessment={status:"LOWER_SEVERITY_OBSERVATION_IN_NONEXECUTING_PROTOTYPE",cleared:false,rationale:inherited.description};reachability="VIEW_OR_REVIEW_LOGIC_ONLY_EXECUTION_UNIMPLEMENTED";
        fundsAtRisk="None held or spendable by this prototype. Zero highs do not cover TreasuryV1 custody, fee entitlements, a future execution adapter or NFT purchasing.";
        preconditions=["The exact prototype remains nonexecuting, without custody or inheritable V1 credits."];mitigations=["Execution is unavailable; unsupported independent pricing stays NO-GO; no transaction or royalty redirect follows from a reviewed request."];
        tests=["packages/contracts/treasury-purchase-v2/test/PurchaseBoundaryV2.t.sol"];tests.forEach(checkReference);remainingUncertainty="Timestamp and literal findings remain visible. A separate future spending-capable module needs a new exact closure and independent route/price verification; source review is not a live-market guarantee.";
        ownerDecision="No spending activation. NFT collection purchasing is a separate future bounded task; own-token buying remains blocked without independent pricing.";
      }
      const workflow=definition.id==="reclaim-v2-permanent-trial"?".github/workflows/reclaim-v2-security.yml":".github/workflows/security-analysis.yml";
      findings.push({key,scopeId:definition.id,findingId:row.id,detector:row.check,severity:row.impact,confidence:row.confidence,lifecycle:definition.state,group,
        assessment,independentlyResolved:false,cleared:false,
        reviewPriority:definition.id==="reclaim-v1-rejected"?"ARCHIVED_REJECTED_MODEL_NOT_AN_ACTIVE_RELEASE":definition.id==="treasury-v2-nonspending-prototype"?"NONSPENDING_BOUNDARY_NO_EXECUTABLE_FUNDS":group.startsWith("dependency-")?"PINNED_ARITHMETIC_INTERNAL_EVIDENCE_RETAINED":row.impact==="Medium"?"AUTHORIZATION_CONTINUITY_AND_FUTURE_COMPOSITION":"ACTIVE_CRITICAL_FUND_FLOW_EXACT_RUNTIME_AND_CONSERVATION_REVIEW",
        exploitEvidenceStatus:definition.id==="reclaim-v1-rejected"?"HISTORICAL_MODEL_REJECTED_NOT_RELEASE_ELIGIBLE":definition.id==="treasury-v2-nonspending-prototype"?"NO_ASSET_EXECUTION_IN_REVIEWED_PROTOTYPE":"NO_CONCRETE_UNRESOLVED_EXPLOIT_ESTABLISHED_BY_REFERENCED_INTERNAL_ASSESSMENT_NOT_PROOF_OF_ABSENCE",
        reachability,fundsAtRisk,exploitPreconditions:preconditions,existingMitigations:mitigations,remainingUncertainty,
        sourceLocations,externalCalls:sourceLocations.filter(location=>location.role.startsWith("external_call")),balanceBaselines:sourceLocations.filter(location=>location.role==="balance_before_call"),settlementAssertions:sourceLocations.filter(location=>location.role==="stale_balance_use"),
        runtimeIdentity:{compilerInputSha256:report.inputSha256,analysisInputSha256:report.analysisInputSha256,manifest:definition.manifest,templates,dependencyPinsReference:definition.id==="core-and-dependencies-4663"?definition.manifest+"#externalRuntimePins":null,note:"Template SHA256 and source pins identify the reviewed closure; materialized immutables and current on-chain runtime identities require separate deployment/receipt verification. No new RPC validation is claimed."},
        tests,evidence:[definition.report,definition.disposition,...(inherited.evidence??[])],ownerDecision,
        releaseGate:{overall:"BLOCKED_NO_BROADCAST",static:definition.high?"FAIL_HIGH_RETAINED":"NO_HIGH_IN_NONEXECUTING_SCOPE_ONLY",workflow,ownerApproval:false,paidAuditRequired:false,historicalProductRejected:definition.id==="reclaim-v1-rejected",noAutomaticWaiver:true}});
    }
    const registered=findings.slice(detailedBefore),scopeCounts=counts(unique.map(value=>value.row));
    scopes.push({id:definition.id,lifecycle:definition.state,report:definition.report,reportCompressedSha256:sha(reportBytes),reportUncompressedSha256:sha(raw),compilerManifest:definition.manifest,compilerInput:definition.input??"REPRODUCE_WITH_FIXED_SUPPLY_PROFILE_4663_COMMAND",compilerInputSha256:report.inputSha256,analysisInputSha256:report.analysisInputSha256,
      analysisInputDifference:"The preserved analyzer requests AST/source-map/devdoc/userdoc outputs using Crytic Compile serialization. Both SHA256 values are retained; output-selection/serialization differences are not source or runtime equivalence proof by themselves.",
      tool:report.tool,cryticCompile:report.cryticCompile,compilerSha256:report.compilerSha256,compilerVersion:manifest.compilerVersion,detectorCount:report.detectorCount,sourceCount:report.sources,
      sourcePins:[...compiledPins].map(([path,compiledSourceSha256Lf])=>({path:"packages/contracts/"+path,compiledSourceSha256Lf,repositorySourceSha256Lf:originalPins.get(path)})),sourceTransformations:manifest.transformations??[],runtimeTemplates:manifest.templates??{},externalRuntimePins:manifest.externalRuntimePins??null,
      rawRows:report.detectors.length,deduplicatedRows:unique.length,exactDuplicateRows:report.detectors.length-unique.length,rawSeverityCounts:scopeCounts,registeredRows:registered.length,registeredSeverityCounts:counts(registered.map(row=>({impact:row.severity}))),strictHighGateExit:definition.high?1:0,
      noInheritedClearance:definition.id==="treasury-v2-nonspending-prototype",scopeLimits:definition.id==="core-and-dependencies-4663"?["Historical V1 and V2 funding-parser limitations remain distinct from this normalized exact compiler-closure result; this register does not prove full static precision."]:definition.id==="reclaim-v2-permanent-trial"?disposition.coverageLimits:definition.id==="reclaim-v1-rejected"?["Rejected reversible product; retained reports are not permission to restore it."]:definition.id==="treasury-v2-nonspending-prototype"?["No execution, custody or V1-credit migration exists; three lower-severity observations remain."]:["Six V1 highs remain internally disputed and unresolved; a nonspending V2 report does not clear them."]});
  }
  findings.sort((a,b)=>order(a.scopeId,b.scopeId)||order(a.severity,b.severity)||order(a.findingId,b.findingId));rawFindingIndex.sort((a,b)=>order(a.scopeId,b.scopeId)||order(a.findingId,b.findingId));
  const rawHigh=rawFindingIndex.filter(row=>row.severity==="High"),registeredHigh=findings.filter(row=>row.severity==="High");assert.equal(rawHigh.length,39);assert.equal(registeredHigh.length,39);assert.equal(findings.length,49);
  return{schemaVersion:1,task:80,baselineCommit:"526cf004d267596f6203f977be40439825f1204b",status:"BLOCKED_NO_BROADCAST",broadcastAuthorized:false,productionChanged:false,independentAudit:"NOT_PERFORMED",paidAuditRequired:false,
    purpose:"Read-only reconstruction of retained detector reports, source/template identities and inherited internal dispositions. Generation does not run Slither, reproduce an exploit or constitute new independent clearance.",
    deduplication:{key:["analysisInputSha256","detector","findingId"],exactOnly:true,neverDeduplicateByDescriptionRootCauseOrContract:true,noCrossClosureClearance:true},
    selection:"All High findings in all five exact scopes; the seven already assessed governance Medium findings; all three lower-severity observations of the nonexecuting prototype. Other rows remain indexed, counted and undispositioned here.",
    summary:{rawRows:rawFindingIndex.length,deduplicatedScopedRows:scopes.reduce((sum,scope)=>sum+scope.deduplicatedRows,0),detailedRegisteredRows:findings.length,rawHighRows:rawHigh.length,deduplicatedRegisteredHighRows:registeredHigh.length,registeredGovernanceMedium:findings.filter(row=>row.scopeId==="core-and-dependencies-4663"&&row.severity==="Medium").length,registeredPrototypeLower:findings.filter(row=>row.scopeId==="treasury-v2-nonspending-prototype").length,rawWarningCountIsNotVulnerabilityCount:true,independentlyClearedHighFindings:0,clearedHighFindings:0,unregisteredRawRows:rawFindingIndex.filter(row=>!row.detailed).length,unregisteredSeverityCounts:counts(rawFindingIndex.filter(row=>!row.detailed).map(row=>({impact:row.severity})))},
    limitations:["Internal pinned-path false-positive assessments are inherited labels, not independent audit conclusions or a passing static gate.","The59 remaining Medium and other lower-severity rows are preserved and indexed but not individually dispositioned by this requested high-priority register.","No historical source, scope filter, detector severity, custody assertion or failed high gate was changed.","Actual deployed bytecode, materialized immutable inputs, provider/traces, reorg recovery, L1 finality and physical-wallet acceptance require separate exact evidence.","Confirmed high-impact defects and unresolved plausible material loss paths block the affected release; owner approval does not manufacture missing verification.","Independent verification-policy corrections, including transaction-envelope admission, are tracked separately in docs/RMT_SECURITY_REMEDIATION_AND_RELEASE_GATES.md and never subtracted from Slither counts."],
    scopes,findings,rawFindingIndex,inputs:[...inputFiles.values()].sort((a,b)=>order(a.path,b.path))};
}

export function serializedRegister(register){return JSON.stringify(register,null,2)+"\n";}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert.ok(args.length===1&&["--write","--check"].includes(args[0]),"Use --write or --check only");
  const expected=serializedRegister(buildFindingsRegister());
  if(args[0]==="--write"){mkdirSync(dirname(resolve(repository,registerPath)),{recursive:true});writeFileSync(resolve(repository,registerPath),expected);}
  else assert.equal(lf(readFile(registerPath)).toString("utf8"),expected,"Generated findings register is stale or altered");
  console.log("Task080 register:334 raw rows,49 detailed records,39 retained highs; BLOCKED_NO_BROADCAST.");
}
