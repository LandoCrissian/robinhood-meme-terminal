import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const contractsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(contractsRoot, "../../apps/web/lib/generated/mainnet-stack.json");
const artifacts = {
  governance: "out/ExpandableGovernance.sol/ExpandableGovernance.json",
  governanceV6: "out/RMTV6Governance.sol/RMTV6Governance.json",
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

const result = {};
for (const [name, path] of Object.entries(artifacts)) {
  const artifact = JSON.parse(await readFile(resolve(contractsRoot, path), "utf8"));
  result[name] = { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

const acceptsProspectiveSigner = result.governanceV6.abi.some((item) =>
  item.type === "function"
    && item.name === "acceptSignerRole"
    && item.inputs?.length === 5
    && item.inputs[0]?.type === "uint64"
    && item.inputs[1]?.type === "uint8"
    && item.inputs[2]?.type === "address"
    && item.inputs[3]?.type === "uint256"
    && item.inputs[4]?.type === "uint64"
);
const revokesProspectiveSignerAcceptance = result.governanceV6.abi.some((item) =>
  item.type === "function"
    && item.name === "revokeSignerRoleAcceptance"
    && item.inputs?.length === 1
    && item.inputs[0]?.type === "uint64"
);
if (!acceptsProspectiveSigner || !revokesProspectiveSignerAcceptance) {
  throw new Error("RMTV6Governance artifact is missing the signer acceptance or revocation ABI; rebuild the final contracts before exporting.");
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result)}\n`);
console.log(`Wrote ${output}`);
