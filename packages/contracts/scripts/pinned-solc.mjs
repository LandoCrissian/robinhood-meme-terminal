import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const hashes = Object.freeze({
  "darwin-x64": "0ff016aef2396b12d1fc65429d8ea6cf53c2ee4b041bb8925644615ee1c30ab9",
  "linux-x64": "d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef",
  "win32-x64": "537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67",
});
// Debian bookworm signed qemu-user 1:7.2+dfsg-7+deb12u18+b3, arm64.
// This is an explicit local-test execution mode, never an alternative compiler.
const qemuHash = "ca7b4d72cb2a1a36dd63e31ae989ec909d4c4a711981bc318ae64ed191e96167";
const compilerArguments = ["--standard-json", "--no-import-callback"];
const environment = process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {};

export function verifyCompilerIdentity({executableSha256, executorSha256, host, emulated}) {
  if (emulated) {
    assert.equal(host, "linux-arm64", "Pinned emulation is only supported on Linux ARM64");
    assert.equal(executableSha256, hashes["linux-x64"], "Wrong pinned solc executable");
    assert.equal(executorSha256, qemuHash, "Wrong pinned QEMU executable");
    return "linux-x64";
  }
  assert.ok(hashes[host], "Unsupported compiler host; explicit verified emulation is required on ARM64");
  assert.equal(executableSha256, hashes[host], "Wrong pinned solc executable");
  assert.equal(executorSha256, undefined, "Native compilation cannot silently select an executor");
  return host;
}

export function verifiedSolcExecution({solc, solcEmulator}, host = process.platform + "-" + process.arch) {
  assert.equal(typeof solc, "string", "Supply the pinned solc executable");
  const executableSha256 = digest(readFileSync(solc));
  const executorSha256 = solcEmulator ? digest(readFileSync(solcEmulator)) : undefined;
  const executablePlatform = verifyCompilerIdentity({executableSha256, executorSha256, host, emulated: !!solcEmulator});
  if (solcEmulator) return {command: resolve(solcEmulator), prefix: ["-L", "/usr/x86_64-linux-gnu", resolve(solc)],
    executablePlatform, executableSha256,
    emulation: {hostPlatform: host, compilerPlatform: executablePlatform, executorSha256,
      executorPackage: "Debian qemu-user 1:7.2+dfsg-7+deb12u18+b3 (arm64)",
      runtimePrefix: "/usr/x86_64-linux-gnu"}};
  return {command: resolve(solc), prefix: [], executablePlatform, executableSha256};
}

function privateOwnedPath(path) {
  if (process.platform !== "win32") {
    const metadata = lstatSync(path);
    assert.equal(metadata.uid, process.getuid(), "Compiler cache must belong to the current user");
    assert.equal(metadata.mode & 0o077, 0, "Compiler cache must be private to the current user");
  }
}

export function readCompilerCache(file, identity) {
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), "Compiler cache entry must be a real file");
  privateOwnedPath(file);
  assert.ok(lstatSync(file).size <= 48 * 1024 * 1024, "Oversized compiler cache entry");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(saved.identity, identity, "Compiler cache identity mismatch");
  assert.equal(typeof saved.output, "string", "Compiler cache output missing");
  assert.equal(digest(saved.output), saved.outputSha256, "Compiler cache output digest mismatch");
  const decoded = JSON.parse(saved.output);
  assert.equal((decoded.errors ?? []).filter(row => row.severity === "error").length, 0, "Cached compiler errors");
  return saved.output;
}

/** Cache is private local test output, bound to every compiler/input/executor byte.
 * A corrupt or mismatched entry is rejected, never silently recompiled over. */
export function executePinnedSolc(options, input) {
  assert.equal(typeof input, "string");
  const execution = verifiedSolcExecution(options);
  const identity = {schemaVersion: 1, inputSha256: digest(input),
    compilerSha256: execution.executableSha256,
    executorSha256: execution.emulation?.executorSha256 ?? null,
    arguments: compilerArguments};
  const key = digest(JSON.stringify(identity));
  let file;
  if (options.solcCache) {
    const directory = resolve(options.solcCache);
    if (!existsSync(directory)) mkdirSync(directory, {mode: 0o700, recursive: true});
    assert.ok(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(), "Compiler cache must be a real directory");
    privateOwnedPath(directory);
    file = join(directory, key + ".json");
    if (existsSync(file)) return readCompilerCache(file, identity);
  }
  const output = execFileSync(execution.command, [...execution.prefix, ...compilerArguments], {
    cwd: options.cwd, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    timeout: execution.emulation ? 1_200_000 : 240_000, windowsHide: true, env: environment,
  });
  const decoded = JSON.parse(output);
  assert.equal((decoded.errors ?? []).filter(row => row.severity === "error").length, 0,
    "Compiler returned errors; failed output cannot enter the cache");
  if (file) writeFileSync(file, JSON.stringify({identity, output, outputSha256: digest(output)}),
    {flag: "wx", mode: 0o600});
  return output;
}
