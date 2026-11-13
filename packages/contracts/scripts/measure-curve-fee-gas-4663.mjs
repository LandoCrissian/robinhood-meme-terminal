import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

const requireWeb = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const { decodeFunctionData, decodeFunctionResult, encodeFunctionData, isAddress, isHash, parseAbi, zeroAddress } = requireWeb("viem");
const endpoint = "https://rpc.mainnet.chain.robinhood.com/";
const nodeInterface = "0x00000000000000000000000000000000000000C8";
const l1Method = "gasEstimateL1Component";
const nodeAbi = parseAbi([
  "function gasEstimateL1Component(address to,bool contractCreation,bytes data) returns (uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)",
]);
const operationAbi = parseAbi([
  "function collectLpFees(address token,uint256 deadline)",
  "function claim()",
  "function claimAsset(bool native)",
]);
const readOnly = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_gasPrice", "eth_call"]);
const { values } = parseArgs({ options: { "fork-evidence": { type: "string", multiple: true } } });
const files = values["fork-evidence"] ?? [];
assert.ok(files.length >= 1 && files.length <= 3, "Provide one to three exact loopback evidence files.");

const observations = files.map((file) => {
  const evidence = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  assert.equal(evidence.manifest.chainId, 4663);
  assert.ok(["1000000000000000000", "2000000000000000000", "4200000000000000000"].includes(evidence.terms.backingWei));
  const { lpFees, deployment, creation, feeCosts } = evidence;
  const operations = ["collection", "combined", "native", "token"].map((name) => {
    const { from, to, calldata, transactionHash, gasUsed, effectiveGasPrice, loopbackExecutionWei } = feeCosts[name];
    assert.ok(isAddress(from) && isAddress(to) && isHash(transactionHash) && /^0x(?:[0-9a-f]{2}){1,256}$/i.test(calldata));
    const decoded = decodeFunctionData({ abi: operationAbi, data: calldata });
    if (name === "collection") {
      assert.equal(decoded.functionName, "collectLpFees");
      assert.equal(decoded.args[0].toLowerCase(), creation.token.toLowerCase());
      assert.equal(to.toLowerCase(), deployment.graduationEngine.toLowerCase());
    } else {
      assert.equal(to.toLowerCase(), lpFees.ledger.toLowerCase());
      if (name === "combined") assert.equal(decoded.functionName, "claim");
      else {
        assert.equal(decoded.functionName, "claimAsset");
        assert.equal(decoded.args[0], name === "native");
      }
    }
    assert.ok(BigInt(gasUsed) > 0n && BigInt(effectiveGasPrice) > 0n);
    assert.equal(BigInt(gasUsed) * BigInt(effectiveGasPrice), BigInt(loopbackExecutionWei));
    return { name, from, to, calldata, transactionHash, gasUsed: BigInt(gasUsed),
      loopbackEffectiveGasPrice: effectiveGasPrice, loopbackExecutionWei };
  });
  return { file, backingWei: evidence.terms.backingWei, compilerInputSha256: evidence.manifest.inputSha256, operations };
});
assert.equal(new Set(observations.map(({ backingWei }) => backingWei)).size, observations.length);

let id = 0;
async function rpc(method, params = []) {
  assert.ok(readOnly.has(method), "RPC method is outside the read-only allowlist.");
  const requestId = ++id;
  const response = await fetch(endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }), redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(method + " failed: " + response.status + " " + JSON.stringify(payload.error));
  assert.equal(payload.id, requestId);
  assert.ok(Object.hasOwn(payload, "result"));
  return payload.result;
}

async function estimatePoster(block, from, to, calldata) {
  const data = encodeFunctionData({ abi: nodeAbi, functionName: l1Method, args: [to, false, calldata] });
  const raw = await rpc("eth_call", [{ from, to: nodeInterface, data }, block]);
  const [gasUnits, l2BaseFee, l1BaseFeeEstimate] = decodeFunctionResult({ abi: nodeAbi, functionName: l1Method, data: raw });
  assert.ok(l2BaseFee > 0n);
  return { gasUnits, l2BaseFee, l1BaseFeeEstimate, posterWei: gasUnits * l2BaseFee };
}

assert.equal(await rpc("eth_chainId"), "0x1237");
const block = await rpc("eth_getBlockByNumber", ["latest", false]);
assert.ok(block && /^0x[1-9a-f][0-9a-f]*$/i.test(block.number) && isHash(block.hash));
const gasPriceWei = BigInt(await rpc("eth_gasPrice"));
assert.ok(gasPriceWei > 0n);
const control = await estimatePoster(block.number, zeroAddress, zeroAddress, "0x");
for (const { operations } of observations) {
  for (const operation of operations) {
    const poster = await estimatePoster(block.number, operation.from, operation.to, operation.calldata);
    assert.equal(poster.l2BaseFee, control.l2BaseFee, "Pinned block returned conflicting L2 base fees.");
    operation.poster = poster;
    operation.combinedEstimateAtL2BaseFeeWei = operation.gasUsed * poster.l2BaseFee + poster.posterWei;
    operation.combinedEstimateAtObservedGasPriceWei = operation.gasUsed * gasPriceWei + poster.posterWei;
  }
}
assert.equal((await rpc("eth_getBlockByNumber", [block.number, false])).hash, block.hash, "Observation block was reorganized.");

console.log(JSON.stringify({
  chainId: 4663, endpoint, nodeInterface, observationBlock: { number: BigInt(block.number), hash: block.hash, timestamp: BigInt(block.timestamp) },
  latestGasPriceWei: gasPriceWei, control, observations,
  limitations: [
    "The operation targets exist on loopback forks. NodeInterface estimates the parent posting component without executing them.",
    "Operation gas units come from exact loopback receipts. Combined totals apply observed public chain prices to those units.",
    "A zero poster quote is an observed response at this block. Future data charges, gas prices and real execution units can differ.",
  ],
}, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
