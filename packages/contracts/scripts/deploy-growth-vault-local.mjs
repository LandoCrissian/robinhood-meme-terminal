import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const [rpcUrl, factoryFile, ...extra] = process.argv.slice(2);
if (!rpcUrl || !factoryFile || extra.length) throw new Error("Use the local RPC URL and guarded factory JSON.");
const url = new URL(rpcUrl);
if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
  || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
  throw new Error("Growth fixtures require a loopback HTTP origin.");
}
const pins = JSON.parse(readFileSync(factoryFile, "utf8"));
assert.equal(pins.chainId, 31337);
assert.equal(pins.engineVersion, 2);
const network = JSON.parse(readFileSync(new URL("../test/fixtures/rmt-v4-deployment-identities.json", import.meta.url))).baseSepolia;
const requireWeb = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const { createPublicClient, createWalletClient, defineChain, getAddress, http, keccak256, parseAbi, zeroAddress } = requireWeb("viem");
const chain = defineChain({
  id: 31337, name: "RMT growth fixture", nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [url.href] } },
});
const transport = http(url.href, { retryCount: 0 });
const publicClient = createPublicClient({ chain, transport });
assert.equal(await publicClient.getChainId(), 31337);
const [anchor, factoryCode, guardCode] = await Promise.all([
  publicClient.getBlock({ blockNumber: BigInt(network.block) }),
  publicClient.getCode({ address: pins.factory }),
  publicClient.getCode({ address: pins.initializationGuard }),
]);
assert.equal(anchor.hash, network.blockHash);
assert.equal(keccak256(factoryCode), pins.factoryRuntimeHash);
assert.equal(keccak256(guardCode), pins.initializationGuardRuntimeHash);
const [creator, reviewerA, reviewerB] = (await publicClient.request({ method: "eth_accounts" })).map((address) => getAddress(address));
assert.ok(creator && reviewerA && reviewerB && new Set([creator, reviewerA, reviewerB]).size === 3,
  "The isolated fixture needs three distinct unlocked test accounts.");
const client = createWalletClient({ account: creator, chain, transport });
const deployerAbi = parseAbi([
  "constructor(address factory,bytes32 factoryRuntimeHash,address reviewerA,address reviewerB)",
  "function factory() view returns (address)",
  "function createVault(bytes32 intentId) returns (address)",
  "function vaultFor(address creator,bytes32 intentId) view returns (address)",
]);
const compiled = spawnSync("forge", ["inspect", "src/RMTV4GrowthVaultV1.sol:RMTV4GrowthVaultDeployerV1", "bytecode"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8",
});
if (compiled.error || compiled.status !== 0) throw new Error(compiled.error?.message ?? compiled.stderr);
const bytecode = compiled.stdout.trim();
if (!/^0x[0-9a-f]+$/i.test(bytecode)) throw new Error("The local deployer bytecode did not compile.");
const hash = await client.deployContract({ abi: deployerAbi, bytecode,
  args: [pins.factory, pins.factoryRuntimeHash, reviewerA, reviewerB] });
const deployment = await publicClient.waitForTransactionReceipt({ hash });
assert.equal(deployment.status, "success");
const deployer = deployment.contractAddress;
assert.ok(deployer);
assert.equal(await publicClient.readContract({ address: deployer, abi: deployerAbi, functionName: "factory" }), getAddress(pins.factory));
const intentId = `0x${randomBytes(32).toString("hex")}`;
const creation = await client.writeContract({ address: deployer, abi: deployerAbi, functionName: "createVault", args: [intentId] });
assert.equal((await publicClient.waitForTransactionReceipt({ hash: creation })).status, "success");
const vault = await publicClient.readContract({ address: deployer, abi: deployerAbi, functionName: "vaultFor", args: [creator, intentId] });
assert.notEqual(vault, zeroAddress);
assert.ok(await publicClient.getCode({ address: vault }));
process.stdout.write(JSON.stringify({
  chainId: 31337, deployer, deployerRuntimeHash: keccak256(await publicClient.getCode({ address: deployer })),
  creator, reviewerA, reviewerB, intentId, vault,
}, null, 2) + "\n");
