import assert from "node:assert/strict";
import {test} from "node:test";
import {localReclaimSourceDiagnostic} from "./reclaim-fixture-diagnostics.js";

test("local Reclaim diagnostics expose only bounded source basenames and positions",()=>{
  const error=new Error("Fixture reclaim evidence unavailable or conflicting");
  error.stack=`Error: secret should never be rendered
    at requireReclaimEvidence (file:///private/user/apps/indexer/src/reclaim-fixture-evidence.ts:25:9)
    at proveReclaimPermanentSurrender (https://user:password@private-rpc.example/reclaim-fixture-evidence.js:219:7)
    at db (C:\\private\\user\\reclaim-fixture-store.ts:80:3)
    at caller (/private/reclaim-fixture-origin.ts:50:4)
    at more (/private/reclaim-fixture-evidence.ts:999:8)
    at rpc (https://private-rpc.example/?token=secret:99:2)`;
  const result=localReclaimSourceDiagnostic(error,31337,true);
  assert.equal(result,"Fixture reclaim source locations: reclaim-fixture-evidence.ts:25:9, reclaim-fixture-evidence.js:219:7, reclaim-fixture-store.ts:80:3, reclaim-fixture-origin.ts:50:4");
  assert.doesNotMatch(result!,/private|secret|password|https|file:|user|token|999/);
});

test("remote errors, unsupported profiles and unknown frames stay undisclosed",()=>{
  for(const error of[new Error("RPC timeout: https://user:password@rpc.example"),new Error("Fixture reclaim caller evidence unavailable or conflicting"),"Fixture reclaim evidence unavailable or conflicting",{message:"Fixture reclaim evidence unavailable or conflicting",stack:"secret"}])
    assert.equal(localReclaimSourceDiagnostic(error,31337,true),null);
  const error=new Error("Fixture reclaim evidence unavailable or conflicting");
  error.stack="Error: secret\n    at rpc (https://user:password@rpc.example:1:2)";
  assert.equal(localReclaimSourceDiagnostic(error,31337,true),null);
  error.stack="Error: secret\n    at require (/private/reclaim-fixture-evidence.ts:25:9)";
  assert.equal(localReclaimSourceDiagnostic(error,4663,true),null);
  assert.equal(localReclaimSourceDiagnostic(error,31337,false),null);
});
