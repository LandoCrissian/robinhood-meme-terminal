import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtempSync, writeFileSync, symlinkSync, rmSync, chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {verifyCompilerIdentity, verifiedSolcExecution, readCompilerCache} from "./pinned-solc.mjs";

const native = {
  "darwin-x64": "0ff016aef2396b12d1fc65429d8ea6cf53c2ee4b041bb8925644615ee1c30ab9",
  "linux-x64": "d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef",
  "win32-x64": "537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67",
};
const qemu = "ca7b4d72cb2a1a36dd63e31ae989ec909d4c4a711981bc318ae64ed191e96167";
const sha = text => createHash("sha256").update(text).digest("hex");
for (const [host, executableSha256] of Object.entries(native)) {
  test("retains exact native compiler identity for " + host, () => {
    assert.equal(verifyCompilerIdentity({host, executableSha256}), host);
    assert.throws(() => verifyCompilerIdentity({host, executableSha256: "0".repeat(64)}), /Wrong pinned solc/);
    assert.throws(() => verifyCompilerIdentity({host, executableSha256, executorSha256:qemu}), /silently select/);
  });
}
test("ARM requires explicit exact compiler and executor identities", () => {
  const good = {host:"linux-arm64", executableSha256:native["linux-x64"], executorSha256:qemu, emulated:true};
  assert.equal(verifyCompilerIdentity(good), "linux-x64");
  assert.throws(() => verifyCompilerIdentity({...good, emulated:false}), /Unsupported compiler host/);
  assert.throws(() => verifyCompilerIdentity({...good, host:"linux-x64"}), /only supported on Linux ARM64/);
  assert.throws(() => verifyCompilerIdentity({...good, executableSha256: "0".repeat(64)}), /Wrong pinned solc/);
  assert.throws(() => verifyCompilerIdentity({...good, executorSha256: "0".repeat(64)}), /Wrong pinned QEMU/);
  assert.throws(() => verifyCompilerIdentity({...good, host:"darwin-arm64"}), /only supported/);
});
test("executable bytes are hashed before execution", () => {
  const directory=mkdtempSync(join(tmpdir(),"rmt-solc-test-"));
  try {
    const file=join(directory,"not-solc");writeFileSync(file,"unverified executable");
    assert.throws(()=>verifiedSolcExecution({solc:file},"linux-x64"),/Wrong pinned solc/);
    assert.throws(()=>verifiedSolcExecution({solc:file,solcEmulator:file},"linux-arm64"),/Wrong pinned solc/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test("cached output must bind the entire exact compiler input and execution identity", () => {
  const directory=mkdtempSync(join(tmpdir(),"rmt-solc-cache-test-"));
  try {
    const file=join(directory,"entry.json"), identity={inputSha256:sha("entire compiler input"),compilerSha256:native["linux-x64"],executorSha256:qemu,arguments:["--standard-json","--no-import-callback"]};
    const output=JSON.stringify({contracts:{},errors:[]});
    const entry={identity,output,outputSha256:sha(output)};
    const write=object=>writeFileSync(file,JSON.stringify(object),{mode:0o600});
    write(entry);assert.equal(readCompilerCache(file,identity),output);
    for(const key of ["inputSha256","compilerSha256","executorSha256"]) {
      write({...entry,identity:{...identity,[key]:"0".repeat(64)}});
      assert.throws(()=>readCompilerCache(file,identity),/identity mismatch/);
    }
    write({...entry,output:output+" "});assert.throws(()=>readCompilerCache(file,identity),/digest mismatch/);
    write({...entry,output:"not JSON",outputSha256:sha("not JSON")});assert.throws(()=>readCompilerCache(file,identity));
    const failed=JSON.stringify({errors:[{severity:"error"}]});
    write({...entry,output:failed,outputSha256:sha(failed)});assert.throws(()=>readCompilerCache(file,identity),/Cached compiler errors/);
    if(process.platform !== "win32") {
      chmodSync(file,0o644);assert.throws(()=>readCompilerCache(file,identity),/must be private/);chmodSync(file,0o600);
    }
    const link=join(directory,"linked.json");symlinkSync(file,link);
    assert.throws(()=>readCompilerCache(link,identity),/must be a real file/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
