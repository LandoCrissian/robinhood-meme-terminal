import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { createPublicClient, http, encodeFunctionData, decodeFunctionResult, parseAbi } = require("viem");
const { values } = parseArgs({ options: { output: { type: "string" }, "zero-poster-policy": { type: "boolean", default: false } } });
assert.ok(values.output, "Supply a fresh evidence output path");
const urls = ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood.api.pocket.network"];
const clients = urls.map(url => createPublicClient({ transport: http(url, { retryCount: 0, timeout: 8_000, fetchOptions: { redirect: "error", cache: "no-store" } }) }));
const abi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns(uint64,uint64,uint256,uint256)"]);
const nativeAbi = parseAbi(["function getL1BaseFeeEstimate() view returns(uint256)", "function getPricesInWei() view returns(uint256,uint256,uint256,uint256,uint256,uint256)"]);
const directory = "0xE677A69A8124714DD0d88b73BDf1B89cc791ca9C";
const targetData = encodeFunctionData({ abi: parseAbi(["function latestVersion() view returns(uint32)"]), functionName: "latestVersion" });
const precompileData = encodeFunctionData({ abi, functionName: "gasEstimateComponents", args: [directory, false, targetData] });
const observations = [];
const report = { schemaVersion: 1, scope: "READ_ONLY_PUBLIC_NITRO_ABI_AVAILABILITY_NOT_TRANSACTION_ACCEPTANCE", observedAt: new Date().toISOString(),
  rpcMethods: ["eth_chainId", "eth_getBlockByNumber", "eth_call"], financialAuthorization: false, signing: false, broadcast: false, observations };
try {
  const heads = await Promise.all(clients.map(async rpc => { assert.equal(await rpc.getChainId(), 4663); return rpc.getBlock(); }));
  const number = heads[0].number < heads[1].number ? heads[0].number : heads[1].number;
  const anchors = await Promise.all(clients.map(rpc => rpc.getBlock({ blockNumber: number })));
  assert.equal(anchors[0].hash, anchors[1].hash);
  for (let index = 0; index < clients.length; index++) {
    const request = { from: "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA", to: "0x00000000000000000000000000000000000000c8", value: "0x0", data: precompileData };
    const result = await clients[index].request({ method: "eth_call", params: [request, "0x" + number.toString(16)] });
    const decoded = decodeFunctionResult({ abi, functionName: "gasEstimateComponents", data: result });
    const row = { provider: index === 0 ? "official" : "pocket", blockNumber: number.toString(), blockHash: anchors[index].hash,
      request, result, gasEstimate: decoded[0].toString(), l1PosterGas: decoded[1].toString(), baseFeeWei: decoded[2].toString(), l1BaseFeeWei: decoded[3].toString() };
    observations.push(row);
    if (values["zero-poster-policy"]) {
      row.native = [];
      for (const functionName of ["getL1BaseFeeEstimate", "getPricesInWei"]) {
        const nativeRequest = { to: "0x000000000000000000000000000000000000006c", data: encodeFunctionData({ abi: nativeAbi, functionName }) };
        const nativeResult = await clients[index].request({ method: "eth_call", params: [nativeRequest, "0x" + number.toString(16)] });
        const nativeDecoded = decodeFunctionResult({ abi: nativeAbi, functionName, data: nativeResult });
        row.native.push({ functionName, request: nativeRequest, result: nativeResult, decoded: Array.isArray(nativeDecoded) ? nativeDecoded.map(String) : String(nativeDecoded) });
      }
      const l1 = row.native[0].decoded, prices = row.native[1].decoded;
      assert.equal(l1, "0"); assert.equal(prices[1], "0");
      assert.ok(BigInt(prices[5]) > 0n && BigInt(prices[3]) + BigInt(prices[4]) === BigInt(prices[5]));
      assert.ok(anchors[index].baseFeePerGas > 0n && decoded[2] > 0n);
      row.nativeL2BaseFeeWei = prices[5]; row.headerBaseFeeWei = anchors[index].baseFeePerGas.toString();
    }
  }
  assert.equal(observations[0].result, observations[1].result);
  for (const client of clients) assert.equal((await client.getBlock({ blockNumber: number })).hash, anchors[0].hash);
  if (values["zero-poster-policy"]) {
    assert.deepEqual(observations[0].native, observations[1].native);
    assert.ok(observations.every(value => BigInt(value.gasEstimate) >= 21000n && value.l1PosterGas === "0" && BigInt(value.baseFeeWei) > 0n && value.l1BaseFeeWei === "0"));
    report.feePolicy = "CORROBORATED_NATIVE_ZERO_POSTER_NOT_TRANSACTION_EXECUTION_ACCEPTANCE";
  } else assert.ok(observations.every(value => BigInt(value.gasEstimate) > BigInt(value.l1PosterGas) && BigInt(value.l1PosterGas) > 0n
    && BigInt(value.baseFeeWei) > 0n && BigInt(value.l1BaseFeeWei) > 0n), "Canonical precompile reply does not satisfy the current positive-poster fee policy");
  report.status = "PASS";
} catch (error) { report.status = "UNAVAILABLE"; report.reason = String(error.message).slice(0, 2_048); process.exitCode = 1; }
const path = resolve(values.output); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, observations: observations.length, scope: report.scope, financialAuthorization: false }));
