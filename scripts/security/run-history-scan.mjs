import {spawnSync} from "node:child_process";
import {mkdirSync,readFileSync,writeFileSync,appendFileSync} from "node:fs";
import {isAbsolute,join,resolve,relative} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {syntheticCanaryText} from "./synthetic-canary.mjs";
import {verifyMarketHistoryPublicData as verifyHistoryPublicData} from "./public-market-identities.mjs";

const {values}=parseArgs({options:{scanner:{type:"string"},output:{type:"string"}}});
const repository=fileURLToPath(new URL("../../",import.meta.url));
if(!values.scanner||!values.output||!isAbsolute(values.scanner)||!isAbsolute(values.output))throw Error("Supply exact absolute --scanner and outside-repository --output paths");
const out=resolve(values.output),rel=relative(repository,out);if(!rel.startsWith("..")&&!isAbsolute(rel))throw Error("Raw scanner output must remain outside the source worktree");
mkdirSync(out,{recursive:true});
const version=spawnSync(values.scanner,["version"],{encoding:"utf8",windowsHide:true});if(version.status!==0||version.stdout.trim()!=="8.30.1")throw Error("Wrong pinned scanner version");
const report=join(out,"history-raw-redacted.json"),scan=spawnSync(values.scanner,["git",".","--config",join(repository,".gitleaks.toml"),"--redact=100","--report-format","json","--report-path",report,"--no-banner"],{cwd:repository,encoding:"utf8",windowsHide:true,maxBuffer:4*1024*1024});
process.stdout.write(scan.stdout??"");process.stderr.write(scan.stderr??"");writeFileSync(join(out,"raw-exit-code.txt"),String(scan.status)+"\n");
if(scan.status!==0&&scan.status!==1)throw Error("Raw history scan did not complete");
const raw=readFileSync(report);if(raw.length>8*1024*1024)throw Error("Raw redacted report exceeds its bound");
const findings=JSON.parse(raw),result={...verifyHistoryPublicData(findings),scannerVersion:"8.30.1",rawExitCode:scan.status};
writeFileSync(join(out,"history-public-classification.json"),JSON.stringify(result,null,2)+"\n");
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Raw secret detection and exact public-data review\n\nRaw Gitleaks exit: **${scan.status}** (${result.rawFindingCount} retained findings).\n\nReview: **${result.status}**; ${result.classified.length} exact immutable public identities, ${result.unclassified.length} unclassified, ${result.missing.length} expected raw observations missing.\n\nThe raw scan is not reported clean. Existing detector configuration and historical ignore file are unchanged. Any additional or changed finding fails. Financial/security release holds remain separate.\n\n`);
// A fresh, deliberately nonfunctional runtime canary proves that the unchanged
// detector and subsequent gate still reject an unrelated key-shaped value.
// Its random bytes never authenticate to anything and are not uploaded.
const canaryFolder=join(out,"ephemeral-canary");mkdirSync(canaryFolder,{recursive:true});
writeFileSync(join(canaryFolder,"source.txt"),syntheticCanaryText());
const canaryReport=join(out,"canary-redacted.json"),canary=spawnSync(values.scanner,["dir",canaryFolder,"--config",join(repository,".gitleaks.toml"),"--redact=100","--report-format","json","--report-path",canaryReport,"--no-banner"],{cwd:repository,encoding:"utf8",windowsHide:true,maxBuffer:1024*1024});
const canaryProcess={schemaVersion:1,scope:"NONFUNCTIONAL_DETECTOR_CONTROL_REDACTED_PROCESS_DIAGNOSTICS",
  status:canary.status,signal:canary.signal,error:canary.error?.message,stdout:canary.stdout??"",stderr:canary.stderr??"",
  fixtureGrammar:"96_LOWERCASE_HEX_CHARACTERS",minimumEntropy:3.75,generatedBytesPublished:false};
writeFileSync(join(out,"canary-process.json"),JSON.stringify(canaryProcess,null,2)+"\n");
// The immutable workflow already uploads this path even when an assertion
// fails. Preserve process evidence there before evaluating the detector result.
writeFileSync(join(out,"canary-rejection.json"),JSON.stringify({...canaryProcess,stage:"PROCESS_CAPTURED_BEFORE_DETECTION_ASSERTION"},null,2)+"\n");
if(canary.status!==1)throw Error("Unrelated synthetic canary was not rejected by the pinned detector");
const canaryRaw=readFileSync(canaryReport);if(canaryRaw.length>1024*1024)throw Error("Canary report exceeds its bound");
const canaryFindings=JSON.parse(canaryRaw);if(!Array.isArray(canaryFindings)||!canaryFindings.length||canaryFindings.some(f=>f.Secret!=="REDACTED"))throw Error("Canary detection evidence is invalid");
const rejected=verifyHistoryPublicData([...findings,...canaryFindings]);if(rejected.status!=="BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING"||!rejected.unclassified.length)throw Error("The gate admitted an unrelated canary finding");
writeFileSync(join(out,"canary-rejection.json"),JSON.stringify({schemaVersion:1,scope:"RUNTIME_GENERATED_SYNTHETIC_CANARY_NOT_A_CREDENTIAL",scannerVersion:"8.30.1",rawExitCode:canary.status,findings:canaryFindings.length,combinedGate:rejected.status,productionAuthorization:false,processDiagnostics:canaryProcess},null,2)+"\n");
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,"Unrelated runtime-generated key-shaped canary: **detected and rejected**, with a redacted report retained. Its generated bytes are not uploaded.\n");
console.log(`Raw scan exit ${scan.status}: ${result.rawFindingCount} retained findings; ${result.classified.length} exact public identities; ${result.unclassified.length} unclassified. Financial gates unchanged.`);
if(result.status!=="PASSED_EXACT_PUBLIC_DATA_ONLY"||scan.status!==1)process.exitCode=1;
