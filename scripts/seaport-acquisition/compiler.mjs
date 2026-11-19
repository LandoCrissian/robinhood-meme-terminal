import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const contracts = join(repository, "packages/contracts");
const normalized = file => readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const historical = JSON.parse(normalized(join(repository, "docs/evidence/rmt-task043/4663-rotation-profile.json")));
const dependencyPins = new Map(historical.sourceSha256.filter(([file]) => file.startsWith("lib/")));
const compilerPins = {
  "darwin-x64": "0ff016aef2396b12d1fc65429d8ea6cf53c2ee4b041bb8925644615ee1c30ab9",
  "linux-x64": "d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef",
  "win32-x64": "537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67",
};

/** Every production source in the separate module is a root. Every reachable
 * import is included, including dependencies; no detector or source filter is
 * used. The existing core compiler/source tree is never rewritten. */
export function buildSeaportAcquisitionInput({ solc }) {
  const executableSha256 = sha256(readFileSync(resolve(solc)));
  assert.equal(executableSha256, compilerPins[process.platform + "-" + process.arch], "Wrong pinned solc executable");
  const roots = [];
  for (const folder of ["seaport-acquisition/src", "seaport-acquisition/interfaces"]) {
    const directory = join(contracts, folder);
    if (!existsSync(directory)) continue;
    for (const file of readdirSync(directory, { recursive: true })) if (file.endsWith(".sol")) roots.push(folder + "/" + file.replaceAll("\\", "/"));
  }
  roots.sort(); assert.ok(roots.length > 0, "NFT acquisition production module is missing");
  const remappings = historical.compilerSettings.remappings;
  const resolveImport = (from, imported) => {
    assert.ok(!isAbsolute(imported) && !imported.includes("\\") && !imported.includes(":"), "Nonportable Solidity import");
    let target = imported.startsWith(".") ? posix.join(posix.dirname(from), imported) : imported;
    for (const mapping of remappings) {
      const separator = mapping.indexOf("="), prefix = mapping.slice(0, separator);
      if (target.startsWith(prefix)) { target = mapping.slice(separator + 1) + target.slice(prefix.length); break; }
    }
    target = posix.normalize(target);
    assert.ok(!target.startsWith("../") && !target.startsWith("/") && target.endsWith(".sol"), "Import leaves pinned contract workspace");
    return target;
  };
  const collected = new Map(), pending = [...roots];
  while (pending.length) {
    const file = pending.pop(); if (collected.has(file)) continue;
    const content = normalized(join(contracts, file));
    if (file.startsWith("lib/")) {
      assert.ok(dependencyPins.has(file), "Dependency lacks an existing reviewed source pin: " + file);
      assert.equal(sha256(content), dependencyPins.get(file), "Dependency source mismatch: " + file);
    }
    collected.set(file, content);
    // Strip comments before reading import declarations; comment text cannot
    // create or hide a reachable source in the compiler closure.
    const declarations = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const imports = [...declarations.matchAll(/\bimport\s+(?:[^;]*?\bfrom\s+)?["']([^"']+)["']\s*;/g)];
    for (const match of imports) pending.push(resolveImport(file, match[1]));
  }
  const sources = Object.fromEntries([...collected].sort(([a], [b]) => a.localeCompare(b)).map(([file, content]) => [file, { content }]));
  const input = JSON.stringify({ language: "Solidity", sources, settings: { ...historical.compilerSettings,
    outputSelection: { "*": { "": ["ast"], "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode"] } } } });
  return { input, manifest: { schemaVersion: 1, profile: "rmt-seaport-acquisition-local-v2", status: "BLOCKED_NO_BROADCAST",
    broadcastAuthorized: false, coreModified: false, compilerVersion: historical.compilerVersion,
    executablePlatform: process.platform + "-" + process.arch, executableSha256,
    compilerSettings: historical.compilerSettings, roots, sourceCount: collected.size,
    sourceSha256: Object.entries(sources).map(([file, unit]) => [file, sha256(unit.content)]), inputSha256: sha256(input),
    scope: "All new production module sources plus every reachable import; tests excluded unless imported by production source",
    transformations: [], dependencyPinManifest: "docs/evidence/rmt-task043/4663-rotation-profile.json" } };
}

export function compileSeaportAcquisition(options) {
  const { input, manifest } = buildSeaportAcquisitionInput(options);
  const output = JSON.parse(execFileSync(resolve(options.solc), ["--standard-json", "--no-import-callback"], {
    cwd: contracts, input, encoding: "utf8", timeout: 240_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
    env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
  }));
  const errors = (output.errors ?? []).filter(error => error.severity === "error");
  assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join("\n"));
  assert.deepEqual(Object.keys(output.sources).sort(), Object.keys(JSON.parse(input).sources).sort(), "Compiler/source closure mismatch");
  const artifacts = {}, templates = {}, immutableNames = {};
  for (const unit of Object.values(output.sources)) for (const definition of unit.ast.nodes ?? []) {
    if (definition.nodeType !== "ContractDefinition") continue;
    for (const field of definition.nodes ?? []) if (field.mutability === "immutable") immutableNames[String(field.id)] = field.name;
  }
  for (const [file, units] of Object.entries(output.contracts)) for (const [name, { abi, evm }] of Object.entries(units)) {
    if (!evm.bytecode.object) continue;
    const bytecode = "0x" + evm.bytecode.object, runtime = "0x" + evm.deployedBytecode.object;
    assert.match(bytecode, /^0x(?:[a-f0-9]{2})+$/, "Unlinked creation code for " + name);
    assert.match(runtime, /^0x(?:[a-f0-9]{2})+$/, "Unlinked runtime for " + name);
    const creationBytes = (bytecode.length - 2) / 2, runtimeBytes = (runtime.length - 2) / 2;
    assert.ok(creationBytes <= 49_152, "EIP-3860 initcode limit: " + name);
    assert.ok(runtimeBytes <= 24_576, "EIP-170 runtime limit: " + name + " bytes=" + runtimeBytes);
    assert.ok(!Object.hasOwn(artifacts, name), "Ambiguous artifact name: " + name);
    const immutableOffsets = evm.deployedBytecode.immutableReferences ?? {};
    artifacts[name] = { abi, bytecode, runtime, immutableOffsets, immutableReferences: Object.values(immutableOffsets).flat() };
    templates[name] = { file, creationBytes, runtimeBytes,
      creationSha256: sha256(Buffer.from(bytecode.slice(2), "hex")), runtimeSha256: sha256(Buffer.from(runtime.slice(2), "hex")) };
  }
  return {
    artifacts, immutableNames,
    sourceAsts: Object.fromEntries(Object.entries(output.sources).map(([file, unit]) => [file, unit.ast])),
    manifest: { ...manifest, templates }, input,
  };
}

/** Fixture assets are a separate compiler input, never production admission. */
export function compileSeaportAcquisitionFixtures(options) {
  const { input, manifest } = buildSeaportAcquisitionInput(options);
  const fixture="nft-acquisition/test/fixtures/NftAcquisitionAssets.sol";
  const data=JSON.parse(input);data.sources={ [fixture]: {content:normalized(join(contracts,fixture))} };
  const fixtureInput=JSON.stringify(data);
  const output=JSON.parse(execFileSync(resolve(options.solc),["--standard-json","--no-import-callback"],{input:fixtureInput,encoding:"utf8",timeout:240_000,maxBuffer:16*1024*1024,windowsHide:true}));
  const errors=(output.errors??[]).filter(e=>e.severity==="error");assert.equal(errors.length,0,errors.map(e=>e.formattedMessage).join("\n"));
  const artifacts={};for(const[name,c]of Object.entries(output.contracts[fixture]))if(c.evm.bytecode.object)artifacts[name]={abi:c.abi,bytecode:"0x"+c.evm.bytecode.object,runtime:"0x"+c.evm.deployedBytecode.object,immutableOffsets:c.evm.deployedBytecode.immutableReferences??{}};
  return{artifacts,input:fixtureInput,manifest:{schemaVersion:1,profile:"rmt-seaport-acquisition-synthetic-fixtures",productionEligibility:false,compilerVersion:manifest.compilerVersion,compilerExecutableSha256:manifest.executableSha256,inputSha256:sha256(fixtureInput),sources:[[fixture,sha256(data.sources[fixture].content)]]}};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { solc: { type: "string" }, "standard-json": { type: "string" }, manifest: { type: "string" } } });
  assert.ok(values.solc, "Supply --solc with the checksum-verified compiler");
  const compiled = compileSeaportAcquisition({ solc: values.solc });
  for (const [file, body] of [[values["standard-json"], compiled.input], [values.manifest, JSON.stringify(compiled.manifest, null, 2) + "\n"]]) {
    if (!file) continue; assert.ok(!existsSync(file), "Use a fresh output path");
    writeFileSync(file, body);
  }
  console.log(JSON.stringify(compiled.manifest, null, 2));
}
