import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("../test/fixtures/rmt-v4-deployment-identities.json", import.meta.url)));
const network = fixture.baseSepolia;
const [rpcArgument, mode, ...extra] = process.argv.slice(2);
if (extra.length || mode && mode !== "--sealed") throw new Error("Expected a loopback URL and optional --sealed.");
const url = new URL(rpcArgument ?? "http://127.0.0.1:8545");
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

const accounts = await rpc("eth_accounts");
const contract = "src/RMTV4LaunchFactoryV1.sol:RMTV4LaunchFactoryV1";
const constructorArgs = [...dependencies.map(({ address }) => address), ...dependencies.map(({ runtimeHash }) => runtimeHash)];
let deployed;
if (mode === "--sealed") {
  if (!Array.isArray(accounts) || accounts.length) throw new Error("Start the isolated fork with --accounts 0.");
  // A disposable local deployment signer exists only in this bootstrap process.
  // The preview web app, worker and gateway never receive a signing key.
  const requireWeb = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
  const { createWalletClient, defineChain, getContractAddress, http, parseAbi } = requireWeb("viem");
  const { generatePrivateKey, privateKeyToAccount } = requireWeb("viem/accounts");
  const account = privateKeyToAccount(generatePrivateKey());
  await rpc("anvil_setBalance", [account.address, "0x8ac7230489e80000"]);
  const client = createWalletClient({
    account, transport: http(url.href, { retryCount: 0 }),
    chain: defineChain({ id: 31337, name: "Sealed RMT preview", nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [url.href] } } }),
  });
  const bytecode = run("forge", ["inspect", contract, "bytecode"]);
  const abi = parseAbi(["constructor(address poolManager,address positionManager,address permit2,bytes32 poolManagerRuntimeHash,bytes32 positionManagerRuntimeHash,bytes32 permit2RuntimeHash)"]);
  const transactionHash = await client.deployContract({ abi, bytecode, args: constructorArgs, nonce: 0 });
  deployed = { transactionHash, deployedTo: getContractAddress({ from: account.address, nonce: 0n }) };
} else {
  const [deployer] = accounts;
  if (!/^0x[0-9a-f]{40}$/i.test(deployer ?? "")) throw new Error("Expected an unlocked local Anvil account.");
  deployed = JSON.parse(run("forge", [
    "create", contract, "--json", "--unlocked", "--broadcast", "--rpc-url", url.href, "--from", deployer,
    "--constructor-args", ...constructorArgs,
  ]));
}
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
