import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const contractsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(contractsRoot, "../../apps/web/lib/generated/mainnet-stack.json");
const artifacts = {
  governance: "out/TwoOfThreeTimelock.sol/TwoOfThreeTimelock.json",
  purposeVault: "out/ProtocolPurposeVault.sol/ProtocolPurposeVault.json",
  hook: "out/V4GraduationHook.sol/V4GraduationHook.json",
  adapter: "out/V4GraduationAdapter.sol/V4GraduationAdapter.json",
  revenueRouter: "out/ProtocolRevenueRouter.sol/ProtocolRevenueRouter.json",
  rewardsController: "out/PurposeRewardsController.sol/PurposeRewardsController.json",
  factory: "out/LowCostMemeLaunchFactoryV4.sol/LowCostMemeLaunchFactoryV4.json",
  registry: "out/VersionedFactoryRegistry.sol/VersionedFactoryRegistry.json"
};

const result = {};
for (const [name, path] of Object.entries(artifacts)) {
  const artifact = JSON.parse(await readFile(resolve(contractsRoot, path), "utf8"));
  result[name] = { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result)}\n`);
console.log(`Wrote ${output}`);
