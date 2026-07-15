import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const contractsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(contractsRoot, "../../apps/web/lib/generated/mainnet-stack.json");
const artifacts = {
  governanceV6: "out/RMTV6Governance.sol/RMTV6Governance.json",
  bootstrapV6: "out/RMTV6BootstrapController.sol/RMTV6BootstrapController.json",
  bootstrapFoundationVerifierV6: "out/RMTV6BootstrapFoundationVerifier.sol/RMTV6BootstrapFoundationVerifier.json",
  bootstrapSmokeVerifierV6: "out/RMTV6BootstrapSmokeVerifier.sol/RMTV6BootstrapSmokeVerifier.json",
  purposeVault: "out/ProtocolPurposeVault.sol/ProtocolPurposeVault.json",
  hook: "out/V5GraduationHook.sol/V5GraduationHook.json",
  adapter: "out/V4GraduationAdapter.sol/V4GraduationAdapter.json",
  revenueRouter: "out/ProtocolRevenueRouterV2.sol/ProtocolRevenueRouterV2.json",
  rewardsController: "out/PurposeRewardsController.sol/PurposeRewardsController.json",
  factory: "out/LowCostMemeLaunchFactoryV5.sol/LowCostMemeLaunchFactoryV5.json",
  launchGateV6: "out/RMTLaunchGate.sol/RMTLaunchGate.json",
  policyRegistryV6: "out/RMTLaunchPolicyRegistry.sol/RMTLaunchPolicyRegistry.json",
  rmtFactoryV6: "out/RMTLaunchFactoryV6.sol/RMTLaunchFactoryV6.json",
  feeSplitterV6: "out/DirectLaunchFeeSplitter.sol/DirectLaunchFeeSplitter.json",
  market: "out/CloneBondingCurveMarketV3.sol/CloneBondingCurveMarketV3.json",
  marketV6: "out/CloneBondingCurveMarketV6.sol/CloneBondingCurveMarketV6.json",
  registry: "out/VersionedFactoryRegistry.sol/VersionedFactoryRegistry.json"
};

const MAX_RUNTIME_BYTES = 24_576;
const MAX_INITCODE_BYTES = 49_152;
const CONSTRUCTOR_HEADROOM_BYTES = 2_048;

function byteLength(value) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) return -1;
  return (value.length - 2) / 2;
}

function inputTypes(item) {
  return item.inputs?.map((input) => input.type) ?? [];
}

function hasConstructor(artifact, types) {
  return artifact.abi.some((item) =>
    item.type === "constructor"
      && JSON.stringify(inputTypes(item)) === JSON.stringify(types)
  );
}

function hasFunction(artifact, name, types) {
  return artifact.abi.some((item) =>
    item.type === "function"
      && item.name === name
      && JSON.stringify(inputTypes(item)) === JSON.stringify(types)
  );
}

function requireFunction(artifactName, functionName, types = []) {
  if (!hasFunction(result[artifactName], functionName, types)) {
    throw new Error(`${artifactName} artifact is missing ${functionName}(${types.join(",")}); rebuild the final contracts before exporting.`);
  }
}

const result = {};
for (const [name, path] of Object.entries(artifacts)) {
  const artifact = JSON.parse(await readFile(resolve(contractsRoot, path), "utf8"));
  const initcodeBytes = byteLength(artifact.bytecode?.object);
  const runtimeBytes = byteLength(artifact.deployedBytecode?.object);
  if (initcodeBytes <= 0 || runtimeBytes <= 0) {
    throw new Error(`${name} is missing deployable initcode or runtime bytecode; rebuild the final contracts before exporting.`);
  }
  if (initcodeBytes > MAX_INITCODE_BYTES - CONSTRUCTOR_HEADROOM_BYTES) {
    throw new Error(`${name} initcode leaves insufficient room for constructor arguments under the EIP-3860 limit.`);
  }
  if (runtimeBytes > MAX_RUNTIME_BYTES) {
    throw new Error(`${name} runtime exceeds the EIP-170 contract-size limit.`);
  }
  result[name] = { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

if (!hasConstructor(result.governanceV6, ["address", "uint64", "uint64"])) {
  throw new Error("RMTV6Governance artifact has the wrong constructor; rebuild the final contracts before exporting.");
}
for (const [functionName, types] of [
  ["acceptSignerRole", ["uint64", "uint8", "address", "uint256", "uint64"]],
  ["revokeSignerRoleAcceptance", ["uint64"]],
  ["configurationEpoch", []],
  ["executionDelay", []],
  ["executionWindow", []],
  ["transactionCount", []]
]) {
  requireFunction("governanceV6", functionName, types);
}

if (!hasConstructor(result.bootstrapV6, ["address"])) {
  throw new Error("RMTV6BootstrapController artifact has the wrong constructor; rebuild the final contracts before exporting.");
}
for (const [functionName, types] of [
  ["activateVerifiedFoundation", ["address", "address", "address", "address", "bytes32"]],
  ["openAfterOfficialSmoke", ["bytes32"]],
  ["foundationVerifier", []],
  ["smokeVerifier", []],
  ["bootstrapAvailable", []],
  ["expiresAt", []],
  ["state", []]
]) {
  requireFunction("bootstrapV6", functionName, types);
}
for (const artifactName of ["bootstrapFoundationVerifierV6", "bootstrapSmokeVerifierV6"]) {
  if (!hasConstructor(result[artifactName], ["address"])) {
    throw new Error(`${artifactName} artifact has the wrong controller-bound constructor.`);
  }
  requireFunction(artifactName, "controller", []);
}

if (!hasConstructor(result.registry, ["address", "uint256", "address", "bytes32", "address"])) {
  throw new Error("VersionedFactoryRegistry artifact has the wrong five-argument constructor.");
}
for (const [functionName, types] of [
  ["bootstrapActivateFactory", ["address", "bytes32"]],
  ["bootstrapConsumed", []],
  ["pendingExpirationTime", []],
  ["pendingConfigurationEpoch", []]
]) {
  requireFunction("registry", functionName, types);
}

if (!hasConstructor(result.launchGateV6, ["address", "address", "uint64", "address"])) {
  throw new Error("RMTLaunchGate artifact has the wrong four-argument constructor.");
}
for (const [functionName, types] of [
  ["bootstrapUnpause", []],
  ["setGuardian", ["address"]],
  ["unpauseExpiresAt", []],
  ["unpauseConfigurationEpoch", []]
]) {
  requireFunction("launchGateV6", functionName, types);
}

if (!hasConstructor(result.policyRegistryV6, ["address", "address", "uint64", "address", "address", "address"])) {
  throw new Error("RMTLaunchPolicyRegistry artifact has the wrong six-argument constructor.");
}
for (const [functionName, types] of [
  ["setGuardian", ["address"]],
  ["scheduledOperationExpirations", ["bytes32"]],
  ["scheduledOperationConfigurationEpochs", ["bytes32"]]
]) {
  requireFunction("policyRegistryV6", functionName, types);
}

if (!hasConstructor(result.rmtFactoryV6, ["address", "address", "address", "uint256", "uint256", "address", "address", "address"])) {
  throw new Error("RMTLaunchFactoryV6 artifact has the wrong eight-argument constructor.");
}
for (const [functionName, types] of [
  ["launchOfficialWhilePaused", ["string"]],
  ["launch", ["bytes32", "string", "string", "string"]],
  ["launchCount", []],
  ["getLaunch", ["uint256"]]
]) {
  requireFunction("rmtFactoryV6", functionName, types);
}
for (const [functionName, types] of [
  ["totalReceived", []],
  ["totalPaid", []],
  ["pending", ["address"]],
  ["creator", []],
  ["creatorPayoutAuthority", []]
]) {
  requireFunction("feeSplitterV6", functionName, types);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result)}\n`);
console.log(`Wrote ${output}`);
