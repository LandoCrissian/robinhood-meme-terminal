import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const [rpcUrl, token, hook, ...extra] = process.argv.slice(2);
if (!rpcUrl || !token || !hook || extra.length) throw new Error("Use the local RPC URL, launch token and guard.");
const url = new URL(rpcUrl);
assert.ok(url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)
  && url.port && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash);
const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, erc20Abi, http, keccak256,
  parseAbi, parseAbiItem, parseEther, zeroAddress } = requireWeb("viem");
const { baseSepolia: pins } = JSON.parse(readFileSync(
  new URL("../../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json", import.meta.url), "utf8",
));
const router = "0x8702463e73f74d0b6765aBceb314Ef07aCb92650";
const routerHash = "0x2aa613cbe4bce524d53cb3ed1d6a8924d9ef1ccd00b250b64aa77c8eb376bf7e";
const chain = defineChain({
  id: 31337, name: "Router interoperability fixture", nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [url.href] } },
});
const transport = http(url.href, { retryCount: 0 });
const client = createPublicClient({ chain, transport, cacheTime: 0 });
assert.equal(await client.getChainId(), 31337);
assert.equal((await client.getBlock({ blockNumber: BigInt(pins.block) })).hash, pins.blockHash);
const [routerCode, quoterCode] = await Promise.all([
  client.getCode({ address: router }), client.getCode({ address: pins.quoter.address }),
]);
assert.equal(keccak256(routerCode), routerHash);
assert.equal(keccak256(quoterCode), pins.quoter.runtimeHash);
assert.equal((BigInt(hook) & 0x3fffn), 0x2000n);
const poolKey = { currency0: zeroAddress, currency1: token, fee: 3000, tickSpacing: 60, hooks: hook };
const routerAbi = parseAbi(["function poolManager() view returns (address)", "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
assert.equal((await client.readContract({ address: router, abi: routerAbi, functionName: "poolManager" })).toLowerCase(),
  pins.poolManager.address.toLowerCase());
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
const permitAbi = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]);
const swapParam = parseAbiItem(
  "function params(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData) swap)",
).inputs[0];
const accounts = await client.request({ method: "eth_accounts" });
const account = accounts[4];
assert.ok(account, "The isolated fork needs a separate test trader.");
const wallet = createWalletClient({ account, chain, transport });
async function write(contract) {
  const hash = await wallet.writeContract(contract);
  assert.equal((await client.waitForTransactionReceipt({ hash })).status, "success");
  return hash;
}

async function swap(zeroForOne, amountIn) {
  const { result: [quote] } = await client.simulateContract({ address: pins.quoter.address, abi: quoterAbi,
    functionName: "quoteExactInputSingle", args: [{ poolKey, zeroForOne, exactAmount: amountIn, hookData: "0x" }], account });
  const minimumOut = quote * 99n / 100n;
  assert.ok(minimumOut > 0n);
  const minimumHopPrice = minimumOut * 10n ** 36n / amountIn;
  assert.ok(minimumHopPrice > 0n);
  const [currencyIn, currencyOut] = zeroForOne ? [zeroAddress, token] : [token, zeroAddress];
  const exactInput = encodeAbiParameters([swapParam], [{
    poolKey, zeroForOne, amountIn, amountOutMinimum: minimumOut, minHopPriceX36: minimumHopPrice, hookData: "0x",
  }]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], [currencyIn, amountIn, true]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyOut, minimumOut]);
  const swapInput = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x060b0f", [exactInput, settle, take]]);
  const deadline = (await client.getBlock()).timestamp + 300n;
  return write({ address: router, abi: routerAbi, functionName: "execute",
    args: ["0x10", [swapInput], deadline], value: zeroForOne ? amountIn : 0n });
}

const buy = await swap(true, parseEther("0.0001"));
const tokens = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });
const sellAmount = tokens / 2n;
assert.ok(sellAmount > 0n);
await write({ address: token, abi: erc20Abi, functionName: "approve", args: [pins.permit2.address, sellAmount] });
await write({ address: pins.permit2.address, abi: permitAbi, functionName: "approve",
  args: [token, router, sellAmount, Number((await client.getBlock()).timestamp + 300n)] });
const sell = await swap(false, sellAmount);
assert.equal(await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account, pins.permit2.address] }), 0n);
console.log(JSON.stringify({ chainId: 31337, router, poolKey, buy, sell }, null, 2));
