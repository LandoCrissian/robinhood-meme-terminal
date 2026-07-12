import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const contractsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(contractsRoot, "../../apps/web/lib/generated/testnet-stack.json");
const artifacts = {
  poolManager: "out/PoolManager.sol/PoolManager.json",
  hook: "out/V4GraduationHook.sol/V4GraduationHook.json",
  adapter: "out/V4GraduationAdapter.sol/V4GraduationAdapter.json",
  factory: "out/MemeLaunchFactory.sol/MemeLaunchFactory.json"
};

const result = {};
for (const [name, path] of Object.entries(artifacts)) {
  const artifact = JSON.parse(await readFile(resolve(contractsRoot, path), "utf8"));
  result[name] = { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result)}\n`);
console.log(`Wrote ${output}`);
