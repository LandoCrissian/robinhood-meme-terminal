import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("../test/fixtures/rmt-v4-deployment-identities.json", import.meta.url)));
const network = fixture.baseSepolia;
const url = new URL(process.argv[2] ?? "http://127.0.0.1:8545");
if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
  throw new Error("Use a loopback HTTP Anvil URL.");
}

async function rpc(method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`RPC ${method} returned ${response.status}.`);
  const result = await response.json();
  if (result.error) throw new Error(`RPC ${method}: ${result.error.message}`);
  return result.result;
}

function run(tool, args, input) {
  const result = spawnSync(tool, args, { cwd: root, encoding: "utf8", input });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? `${tool} exited with ${result.status}\n${result.stderr}\n${result.stdout}`);
  }
  return result.stdout.trim();
}

async function runtimeHash(address) {
  const code = await rpc("eth_getCode", [address, "latest"]);
  if (!code || code === "0x") throw new Error(`Missing runtime at ${address}.`);
  return run("cast", ["keccak"], `${code}\n`);
}

if (Number(await rpc("eth_chainId")) !== 31337) throw new Error("Expected local chain 31337.");
const info = await rpc("anvil_nodeInfo");
if (Number(info?.forkConfig?.forkBlockNumber) !== network.block) {
  throw new Error(`Expected Anvil fork of Base Sepolia block ${network.block}.`);
}
const anchor = await rpc("eth_getBlockByNumber", [`0x${network.block.toString(16)}`, false]);
if (anchor?.hash !== network.blockHash) throw new Error("Local fork block differs from the Base Sepolia anchor.");

const dependencies = [network.poolManager, network.positionManager, network.permit2];
const allDependencies = [...dependencies, network.universalRouter, network.quoter, network.stateView];
for (const deployment of allDependencies) {
  if (await runtimeHash(deployment.address) !== deployment.runtimeHash) {
    throw new Error(`Runtime identity differs from the pin at ${deployment.address}.`);
  }
}

async function verifyBinding(deployment, signature, expected) {
  const data = run("cast", ["sig", signature]);
  const result = await rpc("eth_call", [{ to: deployment.address, data }, "latest"]);
  const encodedAddress = `0x${expected.address.slice(2).toLowerCase().padStart(64, "0")}`;
  if (result !== encodedAddress) throw new Error(`Unexpected ${signature} binding at ${deployment.address}.`);
}

for (const deployment of [network.positionManager, network.universalRouter, network.quoter, network.stateView]) {
  await verifyBinding(deployment, "poolManager()", network.poolManager);
}
await verifyBinding(network.positionManager, "permit2()", network.permit2);

const [deployer] = await rpc("eth_accounts");
if (!/^0x[0-9a-f]{40}$/i.test(deployer ?? "")) throw new Error("Expected an unlocked local Anvil account.");
const deployed = JSON.parse(run("forge", [
  "create", "src/RMTV4LaunchFactoryV1.sol:RMTV4LaunchFactoryV1",
  "--json", "--unlocked", "--broadcast", "--rpc-url", url.href, "--from", deployer,
  "--constructor-args", ...dependencies.map(({ address }) => address), ...dependencies.map(({ runtimeHash }) => runtimeHash),
]));
const receipt = await rpc("eth_getTransactionReceipt", [deployed.transactionHash]);
if (receipt?.status !== "0x1" || receipt.contractAddress?.toLowerCase() !== deployed.deployedTo?.toLowerCase()) {
  throw new Error("Local factory deployment receipt was not verified.");
}

const tip = await rpc("eth_getBlockByNumber", ["latest", false]);
const wallClockSeconds = Math.floor(Date.now() / 1_000);
if (Number(tip.timestamp) < wallClockSeconds) {
  // The pinned upstream block may be much older than a browser-generated deadline.
  await rpc("evm_setNextBlockTimestamp", [wallClockSeconds]);
  await rpc("evm_mine");
}

process.stdout.write(`${JSON.stringify({
  chainId: 31337,
  factory: deployed.deployedTo,
  factoryRuntimeHash: await runtimeHash(deployed.deployedTo),
  deployBlock: Number(receipt.blockNumber),
  transactionHash: receipt.transactionHash,
}, null, 2)}\n`);
