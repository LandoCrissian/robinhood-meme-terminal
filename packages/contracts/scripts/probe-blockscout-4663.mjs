import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const explorer = "https://robinhoodchain.blockscout.com";
const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { keccak256 } = require("viem");
const evidence = new URL("../../../docs/evidence/", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, evidence)));
const release = readJson("fixed-supply-security/4663-profile.json");
const safe = readJson("rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"];
const hexCode = /^0x(?:[a-fA-F0-9]{2})+$/;
const maxBytes = 2_097_152;
const timeoutMs = 10_000;
const dependencies = {
  ...release.externalRuntimePins,
  ...Object.fromEntries(Object.entries({
    safeSingleton: safe.safe_l2, safeProxyFactory: safe.safe_proxy_factory, safeFallbackHandler: safe.compatibility_fallback_handler,
  }).map(([role, { address, registryRuntimeKeccak256: runtimeHash }]) => [role, { address, runtimeHash }])),
};

async function readBounded(get, path, summarize) {
  try {
    const response = await get(explorer + path, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    const observed = { httpStatus: response.status };
    if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("application/json")) {
      await response.body?.cancel();
      return { ...observed, status: "UNAVAILABLE" };
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maxBytes) return { ...observed, status: "RESPONSE_LIMIT" };
      chunks.push(chunk);
    }
    return { ...observed, status: "OBSERVED", ...summarize(JSON.parse(Buffer.concat(chunks, length))) };
  } catch {
    return { status: "UNAVAILABLE" };
  }
}

function configMatches(config) {
  return {
    rustVerifier: config.is_rust_verifier_microservice_enabled === true,
    standardInputSupported: Array.isArray(config.verification_options) && config.verification_options.includes("standard-input"),
    compilerSupported: Array.isArray(config.solidity_compiler_versions) &&
      config.solidity_compiler_versions.includes("v" + release.compilerVersion),
    cancunSupported: Array.isArray(config.solidity_evm_versions) && config.solidity_evm_versions.includes("cancun"),
  };
}

function dependencyIdentity(contract, expected) {
  const runtimeHash = typeof contract.deployed_bytecode === "string" && hexCode.test(contract.deployed_bytecode)
    ? keccak256(contract.deployed_bytecode) : null;
  return {
    isVerified: contract.is_verified === true, isFullyVerified: contract.is_fully_verified === true,
    partialSource: contract.is_partially_verified === true,
    constructorArgumentsAvailable: typeof contract.constructor_args === "string",
    creationBytecodeAvailable: typeof contract.creation_bytecode === "string" && hexCode.test(contract.creation_bytecode),
    runtimeHash, runtimeMatchesPin: runtimeHash === expected.runtimeHash,
  };
}

export async function probeBlockscout(get = fetch) {
  const observedAt = new Date().toISOString();
  const config = await readBounded(get, "/api/v2/smart-contracts/verification/config", configMatches);
  const backend = await readBounded(get, "/api/v2/config/backend-version", ({ backend_version: version }) => ({
    version: typeof version === "string" && /^[a-zA-Z0-9.+-]{1,80}$/.test(version) ? version : null,
  }));
  const external = [];
  const contracts = Object.entries(dependencies);
  for (let offset = 0; offset < contracts.length; offset += 3) {
    external.push(...await Promise.all(contracts.slice(offset, offset + 3).map(async ([role, expected]) => ({
      role, ...expected, ...await readBounded(get, "/api/v2/smart-contracts/" + expected.address,
        (contract) => dependencyIdentity(contract, expected)),
    }))));
  }
  return {
    observedAt, scope: "PUBLIC_GET_ONLY", explorer, chainId: 4663,
    expectedCompiler: release.compilerVersion, config, backend, external,
    newRmtVerification: "DEPLOYMENT_DEPENDENT", sourceVerificationSubmitted: false, broadcastAuthorized: false,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { output: { type: "string" } } });
  assert.ok(values.output, "Supply a fresh --output path");
  const result = await probeBlockscout();
  writeFileSync(values.output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log("Captured public Blockscout GET observations; BLOCKED_NO_BROADCAST");
}
