import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const contractsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(contractsRoot, "../../apps/web/lib/generated/testnet-stack.json");
const artifacts = {
  adapter: "out/TestnetGraduationAdapter.sol/TestnetGraduationAdapter.json",
  factory: "out/LowCostMemeLaunchFactory.sol/LowCostMemeLaunchFactory.json",
  factoryV2: "out/LowCostMemeLaunchFactoryV2.sol/LowCostMemeLaunchFactoryV2.json"
};

const result = {};
for (const [name, path] of Object.entries(artifacts)) {
  const artifact = JSON.parse(await readFile(resolve(contractsRoot, path), "utf8"));
  result[name] = { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result)}\n`);
console.log(`Wrote ${output}`);
