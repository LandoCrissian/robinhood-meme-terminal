import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, encodeDeployData, encodeFunctionData, keccak256, parseAbi, zeroAddress } = require("viem");
const poolKey = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const abi = parseAbi([
  "function graduate(uint256 deadline)",
  "function graduate(address token,uint256 nativeReserve,uint256 tokenReserve,uint256 priceNumerator,uint256 priceDenominator,uint256 deadline)",
  "function approve(address spender,uint256 amount)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "function transferFrom(address from,address to,uint256 amount)",
  "function transferFrom(address from,address to,uint160 amount,address token)",
  "function transfer(address to,uint256 amount)",
  "function modifyLiquidities(bytes unlockData,uint256 deadline)",
  "function unlock(bytes data)",
  "function unlockCallback(bytes data)",
  "function sync(address currency)",
  "function settle()",
  "function take(address currency,address to,uint256 amount)",
  "function collectLpFees(address token,uint256 deadline)",
  "function record(uint256 nativeAmount,uint256 tokenAmount)",
  "function initialize(" + poolKey + " key,uint160 sqrtPriceX96)",
  "function beforeInitialize(address sender," + poolKey + " key,uint160 sqrtPriceX96)",
  "function modifyLiquidity(" + poolKey + " key,(int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt) params,bytes hookData)",
]);
const payload = (functionName, ...args) => encodeFunctionData({ abi, functionName, args });
const encode = (types, values) => encodeAbiParameters(types, values);
const params = (...types) => types.map((type) => ({ type }));
const address = (value) => {
  assert.match(value, /^0x[0-9a-f]{40}$/i, "Missing trace address");
  return value.toLowerCase();
};
const edge = (depth, from, to, input, value = 0n, type = "CALL") => {
  assert.match(input, /^0x(?:[0-9a-f]{2})*$/i, "Missing or invalid trace calldata");
  return {
    depth, type, from: address(from), to: address(to), selector: input.slice(0, 10).toLowerCase(),
    inputHash: keccak256(input), value: BigInt(value).toString(),
  };
};

// Only known static reads may be omitted from the state-changing graph.
export function observedMutationGraph(trace, admittedReads) {
  const graph = [];
  let frameCount = 0;
  function walk(frame, depth, parent) {
    assert.ok(++frameCount <= 180 && depth <= 12, "Unexpectedly large settlement trace");
    assert.ok(frame && ["CALL", "CREATE", "STATICCALL"].includes(frame.type), "Unexpected trace operation");
    assert.equal(frame.error, undefined, "Settlement trace contains a failed internal frame");
    assert.ok(frame.calls === undefined || Array.isArray(frame.calls), "Malformed trace children");
    const call = edge(depth, frame.from, frame.to, frame.input, frame.value, frame.type);
    if (parent) {
      assert.equal(call.from, parent.to, "Disconnected trace frame");
      if (parent.type === "STATICCALL") assert.equal(call.type, "STATICCALL", "Unexpected action beneath a static read");
    }
    if (call.type === "STATICCALL") {
      assert.ok(admittedReads.has(call.to), "Unexpected settlement read target " + call.to);
      assert.equal(call.value, "0");
    } else {
      graph.push(call);
    }
    for (const child of frame.calls ?? []) walk(child, depth + 1, call);
  }
  walk(trace, 0);
  return graph;
}

function unlockEdges(depth, engine, positionManager, poolManager, unlockData, value, deadline) {
  return [
    edge(depth, engine, positionManager, payload("modifyLiquidities", unlockData, deadline), value),
    edge(depth + 1, positionManager, poolManager, payload("unlock", unlockData)),
    edge(depth + 2, poolManager, positionManager, payload("unlockCallback", unlockData)),
  ];
}

const fromHexId = (id) => "0x" + id.toString(16).padStart(64, "0");

function expectedGraduation({
  receipt, curve, engine, token, ledger, poolManager, positionManager, permit2, key, position,
  deadline, liquidityLedgerArtifact, beneficiaries,
}) {
  const { nativeUsed, nativeDust, tokenUsed, tokenDust, liquidity, sqrtPriceX96, positionTokenId } = position;
  const inventory = tokenUsed + tokenDust;
  const backing = nativeUsed + nativeDust;
  const poolKeyParam = { type: "tuple", components: params("address", "address", "uint24", "int24", "address") };
  const mint = encode(
    [poolKeyParam, ...params("int24", "int24", "uint256", "uint128", "uint128", "address", "bytes")],
    [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks], -887_220, 887_220, liquidity,
      nativeUsed, tokenUsed, engine, "0x"],
  );
  const settle = encode(params("address", "address"), [zeroAddress, token]);
  const unlockData = encode(params("bytes", "bytes[]"), ["0x020d", [mint, settle]]);
  const modify = payload("modifyLiquidity", key, {
    tickLower: -887_220, tickUpper: 887_220, liquidityDelta: liquidity, salt: fromHexId(positionTokenId),
  }, "0x");
  const graph = [
    edge(0, receipt.from, curve, payload("graduate", deadline)),
    edge(1, curve, token, payload("approve", engine, inventory)),
    edge(1, curve, engine, payload("graduate", token, backing, inventory, inventory * 3n, backing * 3n, deadline), backing),
    edge(2, engine, ledger, encodeDeployData({
      abi: liquidityLedgerArtifact.abi, bytecode: liquidityLedgerArtifact.bytecode, args: [token, poolManager, beneficiaries],
    }), 0n, "CREATE"),
    edge(2, engine, poolManager, payload("initialize", key, sqrtPriceX96)),
    edge(3, poolManager, key.hooks, payload("beforeInitialize", engine, key, sqrtPriceX96)),
    edge(2, engine, token, payload("transferFrom", curve, engine, tokenUsed)),
    edge(2, engine, token, payload("approve", permit2, tokenUsed)),
    edge(2, engine, permit2, payload("approve", token, positionManager, tokenUsed, Number(deadline))),
    ...unlockEdges(2, engine, positionManager, poolManager, unlockData, nativeUsed, deadline),
    edge(5, positionManager, poolManager, modify),
    edge(5, positionManager, poolManager, payload("sync", zeroAddress)),
    edge(5, positionManager, poolManager, payload("settle"), nativeUsed),
    edge(5, positionManager, poolManager, payload("sync", token)),
    edge(5, positionManager, permit2, payload("transferFrom", engine, poolManager, tokenUsed, token)),
    edge(6, permit2, token, payload("transferFrom", engine, poolManager, tokenUsed)),
    edge(5, positionManager, poolManager, payload("settle")),
  ];
  if (nativeDust !== 0n) graph.push(edge(2, engine, curve, "0x", nativeDust));
  graph.push(edge(1, curve, token, payload("approve", engine, 0n)));
  return graph;
}

function expectedCollection({
  receipt, engine, token, ledger, poolManager, positionManager, key, position,
  deadline, collected: { nativeAmount, tokenAmount },
}) {
  const poke = encode(params("uint256", "uint256", "uint128", "uint128", "bytes"),
    [position.positionTokenId, 0n, 0n, 0n, "0x"]);
  const take = encode(params("address", "address", "address"), [zeroAddress, token, ledger]);
  const unlockData = encode(params("bytes", "bytes[]"), ["0x0011", [poke, take]]);
  const modify = payload("modifyLiquidity", key, {
    tickLower: -887_220, tickUpper: 887_220, liquidityDelta: 0n, salt: fromHexId(position.positionTokenId),
  }, "0x");
  const graph = [
    edge(0, receipt.from, engine, payload("collectLpFees", token, deadline)),
    ...unlockEdges(1, engine, positionManager, poolManager, unlockData, 0n, deadline),
    edge(4, positionManager, poolManager, modify),
  ];
  if (nativeAmount !== 0n) graph.push(
    edge(4, positionManager, poolManager, payload("take", zeroAddress, ledger, nativeAmount)),
    edge(5, poolManager, ledger, "0x", nativeAmount),
  );
  if (tokenAmount !== 0n) graph.push(
    edge(4, positionManager, poolManager, payload("take", token, ledger, tokenAmount)),
    edge(5, poolManager, token, payload("transfer", ledger, tokenAmount)),
  );
  graph.push(edge(1, engine, ledger, payload("record", nativeAmount, tokenAmount)));
  return graph;
}

export async function proveFixedSupplySettlementTrace(client, phase, bindings) {
  const endpoint = new URL(client.transport.url);
  assert.equal(endpoint.href, "http://127.0.0.1:" + endpoint.port + "/");
  assert.ok(endpoint.port && client.chain.id === 4663);
  assert.equal(bindings.receipt.status, "success");
  assert.ok(phase === "graduation" || phase === "collection", "Unexpected settlement phase");
  const trial = await client.request({
    method: "debug_traceTransaction", params: [bindings.receipt.transactionHash, { tracer: "callTracer" }],
  });
  const readTargets = new Set([bindings.factory, bindings.curve, bindings.engine, bindings.token, bindings.ledger,
    bindings.poolManager, bindings.positionManager, bindings.permit2, bindings.key.hooks].map(address));
  const graph = observedMutationGraph(trial, readTargets);
  const expected = phase === "graduation" ? expectedGraduation(bindings) : expectedCollection(bindings);
  assert.deepEqual(graph, expected, phase + " bytecode call path or settlement calldata mismatch");
  return graph;
}
