import assert from "node:assert/strict";
import {readFileSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {gunzipSync} from "node:zlib";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(join(root, "apps/launch-website/package.json"));
const {decodeEventLog, decodeFunctionData, decodeFunctionResult, decodeAbiParameters, parseAbiParameters,
  parseAbi, toFunctionSelector, toEventSelector} = require("viem");
const {values} = parseArgs({options: {traces: {type: "string"}, artifact: {type: "string"}, output: {type: "string"}}});
assert.ok(values.traces && values.artifact && values.output);
const read = path => readFileSync(path);
const raw = values.traces.endsWith(".gz") ? gunzipSync(read(values.traces)) : read(values.traces);
const suites = JSON.parse(raw), artifact = JSON.parse(read(values.artifact));
const event = artifact.abi.find(row => row.type === "event" && row.name === "ConservationSnapshot");
assert.ok(event);
const eventTopic = toEventSelector(event);
const abi = parseAbi(["function collectLpFees(address token,uint256 deadline) returns(uint256,uint256)",
  "function modifyLiquidities(bytes unlockData,uint256 deadline) payable", "function record(uint256,uint256)",
  "function take(address,address,uint256)", "function transfer(address,uint256) returns(bool)"]);
const selector = name => toFunctionSelector(abi.find(row => row.name === name));
const runtime = JSON.parse(read(join(root,"packages/contracts/test/fixtures/task090-canonical-v4-runtime.json")));
const fixed = Object.values(runtime.contracts).map(row => row.address.toLowerCase());
const rows = [];
const split = accrued => {
  const platform=accrued*1000n/10000n, project=accrued-platform;
  // The fresh factory.create call commits this synthetic policy: 2250/9000
  // of the project share to the treasury callback probe, with four distinct
  // immutable recipients. This is not a replacement production policy.
  const treasury=project*2250n/9000n;
  return [project-treasury,treasury,platform/2n,platform-platform/2n];
};
for (const suite of Object.values(suites)) for (const [name,result] of Object.entries(suite.test_results)) {
  assert.equal(result.status,"Success", "Failed test cannot enter successful proof evidence");
  const snapshots = result.logs.filter(log => log.topics[0] === eventTopic).map(log => decodeEventLog({abi:[event],...log}).args);
  for(const {state} of snapshots) for(const currency of ["Native","Token"]) {
    const credit=state["credits"+currency].reduce((sum,value)=>sum+value,0n);
    assert.equal(credit+state["claimed"+currency],state["accrued"+currency],"Asset liabilities must equal verified accrual");
    assert.ok(state["ledger"+currency]>=credit,"Ledger must cover every pending entitlement");
  }
  const arena = result.traces.find(([phase]) => phase === "Execution")[1].arena;
  const collect = arena.filter(node => node.trace.data.startsWith(selector("collectLpFees")));
  const calls = [];
  const subtree = node => [node,...node.children.flatMap(index => subtree(arena[index]))];
  for (const node of collect) {
    const nodes = subtree(node), token = decodeFunctionData({abi,data:node.trace.data}).args[0].toLowerCase();
    const record = nodes.find(child => child.trace.data.startsWith(selector("record")));
    if (node.trace.success) {
      assert.ok(record?.trace.success, "Successful harvest must finish ledger accounting");
      const ledger = record.trace.address.toLowerCase(), allowed = new Set([...fixed,token,ledger,node.trace.address.toLowerCase()]);
      assert.ok(nodes.every(child => allowed.has(child.trace.address.toLowerCase())), "Unexpected harvest callee");
      const modifies = nodes.filter(child => child.trace.data.startsWith(selector("modifyLiquidities")));
      assert.equal(modifies.length,1);
      const [unlock] = decodeFunctionData({abi,data:modifies[0].trace.data}).args;
      const [actions,params] = decodeAbiParameters(parseAbiParameters("bytes actions,bytes[] params"),unlock);
      assert.equal(actions,"0x0011", "Only zero increase and take-pair are admitted");
      const [id,liquidity,max0,max1,hookData] = decodeAbiParameters(parseAbiParameters("uint256,uint256,uint128,uint128,bytes"),params[0]);
      assert.equal(liquidity,0n); assert.equal(max0,0n); assert.equal(max1,0n); assert.equal(hookData,"0x");
      const [currency0,currency1,recipient] = decodeAbiParameters(parseAbiParameters("address,address,address"),params[1]);
      assert.equal(currency0,"0x"+"0".repeat(40)); assert.equal(currency1.toLowerCase(),token); assert.equal(recipient.toLowerCase(),ledger);
      const [nativePaid,tokenPaid] = decodeFunctionResult({abi,functionName:"collectLpFees",data:node.trace.output});
      const recorded = decodeFunctionData({abi,data:record.trace.data}).args;
      assert.deepEqual(recorded,[nativePaid,tokenPaid]);
      const receipts = nodes.filter(child => child.trace.address.toLowerCase() === ledger && child.trace.data === "0x" && child.trace.kind === "CALL");
      assert.equal(receipts.length,1); assert.equal(BigInt(receipts[0].trace.value),nativePaid);
      assert.equal(receipts[0].children.length,0, "Ledger's native receiver must not call outward");
      const transfers = nodes.filter(child => child.trace.address.toLowerCase() === token && child.trace.data.startsWith(selector("transfer")));
      assert.equal(transfers.length,1);
      const [to,amount] = decodeFunctionData({abi,data:transfers[0].trace.data}).args;
      assert.equal(to.toLowerCase(),ledger); assert.equal(amount,tokenPaid);
      calls.push({success:true,token,ledger,originalPosition:id,nativePaid,tokenPaid,actions,calleeSet:[...new Set(nodes.map(n=>n.trace.address.toLowerCase()))],
        frames:nodes.map(n=>({index:n.idx,parent:n.parent,address:n.trace.address,caller:n.trace.caller,kind:n.trace.kind,value:n.trace.value,
          data:n.trace.data,output:n.trace.output,success:n.trace.success,status:n.trace.status}))});
    } else calls.push({success:false,status:node.trace.status,revert:node.trace.output,
      frames:nodes.map(n=>({index:n.idx,parent:n.parent,address:n.trace.address,caller:n.trace.caller,kind:n.trace.kind,value:n.trace.value,
        data:n.trace.data,output:n.trace.output,success:n.trace.success,status:n.trace.status}))});
  }
  for (let i=0;i<snapshots.length;i++) if (snapshots[i].stage === "harvest-before") {
    const before=snapshots[i].state, after=snapshots[i+1]?.state;
    assert.equal(snapshots[i+1]?.stage,"harvest-after");
    assert.equal(after.managerNative+before.pendingNative,before.managerNative);
    assert.equal(after.managerToken+before.pendingToken,before.managerToken);
    assert.equal(after.ledgerNative,before.ledgerNative+before.pendingNative);
    assert.equal(after.ledgerToken,before.ledgerToken+before.pendingToken);
    assert.equal(after.accruedNative,before.accruedNative+before.pendingNative);
    assert.equal(after.accruedToken,before.accruedToken+before.pendingToken);
    assert.equal(after.claimedNative,before.claimedNative); assert.equal(after.claimedToken,before.claimedToken);
    assert.equal(after.pendingNative,0n); assert.equal(after.pendingToken,0n);
    for(const currency of ["Native","Token"]) {
      const previous=split(before["accrued"+currency]), next=split(after["accrued"+currency]);
      for(let beneficiary=0;beneficiary<4;beneficiary++)
        assert.equal(after["credits"+currency][beneficiary],before["credits"+currency][beneficiary]+next[beneficiary]-previous[beneficiary],
          "Exact immutable beneficiary increment: "+currency+"/"+beneficiary);
    }
    for(const field of ["engineNative","engineToken","curveNative","curveToken","buyerNative","buyerToken","strangerNative","strangerToken","id","principal","poolLiquidity","owner","approved"])
      assert.deepEqual(after[field],before[field],"Unexpected protected state change: "+field);
    assert.deepEqual(after.balancesNative,before.balancesNative); assert.deepEqual(after.balancesToken,before.balancesToken);
  }
  rows.push({name,status:result.status,snapshots,harvestCalls:calls});
}
assert.equal(rows.length,5);
assert.deepEqual(rows.map(row=>row.name).sort(),[
  "testCanonicalRuntimeHarvestConservesBothCurrenciesAndOriginalOnlyEntitlements()",
  "testClaimCallbackCannotReenterCreditOrCompleteSameLedgerHarvest()",
  "testRejectedNativeClaimRollsBackTokenTransferAndEveryEntitlementThenAllowsTokenOnly()",
  "testRuntimeDriftAndUnapprovedPrincipalRemovalCannotChangeSettlement()",
  "testSharedManagerUnlockRefusesHarvestWithoutChangingAnyPriorCreditOrPrincipal()"
].sort(),"The exact five focused proof cases must execute");
const report={schemaVersion:1,status:"PASS",finding:"c7bf2ac4fa4faa7416ab573d612269b829e795cf388551b323659cd99e12d48d",
  source:"Task090HarvestProof.t.sol",rawTraceSha256:createHash("sha256").update(raw).digest("hex"),rawTraceBytes:raw.length,
  passed:5,failed:0,skipped:0,conservationSnapshots:rows.reduce((n,row)=>n+row.snapshots.length,0),
  successfulHarvestCalls:rows.flatMap(row=>row.harvestCalls).filter(row=>row.success).length,
  refusedHarvestCalls:rows.flatMap(row=>row.harvestCalls).filter(row=>!row.success).length,rows,
  noLiveExecution:true,sourceOrScannerChanged:false,financialAuthorization:false};
assert.equal(report.conservationSnapshots,12);
assert.equal(report.successfulHarvestCalls,7);
assert.equal(report.refusedHarvestCalls,4);
writeFileSync(values.output,JSON.stringify(report,(_key,value)=>typeof value==="bigint"?value.toString():value,2)+"\n");
console.log(JSON.stringify({status:report.status,passed:5,conservationSnapshots:report.conservationSnapshots,successfulHarvestCalls:report.successfulHarvestCalls,refusedHarvestCalls:report.refusedHarvestCalls}));
