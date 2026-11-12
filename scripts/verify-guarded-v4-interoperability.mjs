import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Read-only consumer of the official v4 interfaces. No RMT indexer or contract clients are used.
const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const {
  createPublicClient, decodeAbiParameters, decodeFunctionData, encodeAbiParameters, getAddress, http,
  isAddress, keccak256, parseAbi, parseAbiItem, parseEther, zeroAddress,
} = requireWeb("viem");
const { baseSepolia: pins } = JSON.parse(readFileSync(
  new URL("../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json", import.meta.url), "utf8",
));
const universalRouter212 = {
  address: "0x8702463e73f74d0b6765aBceb314Ef07aCb92650",
  runtimeHash: "0x2aa613cbe4bce524d53cb3ed1d6a8924d9ef1ccd00b250b64aa77c8eb376bf7e",
};
const routerVersions = { "2.0": pins.universalRouter, "2.1.2": universalRouter212 };

const initialize = parseAbiItem("event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)");
const modifyLiquidity = parseAbiItem("event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)");
const swap = parseAbiItem("event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)");
const poolKeyTuple = parseAbiItem("function pool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)").inputs[0];
const swapTuple = (version) => parseAbiItem(
  `function singleSwap(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,${version === "2.1.2" ? "uint256 minHopPriceX36," : ""}bytes hookData) params)`,
).inputs[0];
const stateAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const guardAbi = parseAbi(["function poolManager() view returns (address)", "function factory() view returns (address)"]);
const factoryAbi = parseAbi(["function initializationGuard() view returns (address)"]);
const actionsInput = [{ type: "bytes" }, { type: "bytes[]" }];
const settleInput = [{ type: "address" }, { type: "uint256" }, { type: "bool" }];
const takeAllInput = [{ type: "address" }, { type: "uint256" }];
const sameAddress = (a, b) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const poolIdFor = (key) => keccak256(encodeAbiParameters([poolKeyTuple], [key]));

function configuration(args) {
  const routerOption = args.at(-1)?.startsWith("--router=") ? args.pop() : "--router=2.0";
  const routerVersion = routerOption.slice("--router=".length);
  const [endpoint, token, guard, start, end] = args;
  assert.ok((args.length === 4 || args.length === 5) && Object.hasOwn(routerVersions, routerVersion),
    "Usage: node scripts/verify-guarded-v4-interoperability.mjs <loopback-rpc> <token> <guard> <start-block> [end-block] [--router=2.0|--router=2.1.2]");
  const rpc = new URL(endpoint);
  assert.ok(rpc.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(rpc.hostname)
    && rpc.port && rpc.pathname === "/" && !rpc.search && !rpc.hash && !rpc.username && !rpc.password,
  "The proof accepts only a loopback HTTP RPC with an explicit port.");
  assert.ok(isAddress(token) && !sameAddress(token, zeroAddress) && isAddress(guard), "Token and guard addresses are required.");
  assert.equal(BigInt(guard) & 0x3fffn, 0x2000n, "Expected the BEFORE_INITIALIZE permission alone.");
  assert.ok(/^\d+$/.test(start) && (end === undefined || /^\d+$/.test(end)), "Use decimal block numbers.");
  return {
    rpc, routerVersion, token: getAddress(token), guard: getAddress(guard), start: BigInt(start),
    end: end === undefined ? undefined : BigInt(end),
  };
}

async function verifyReceipt(client, event) {
  assert.ok(!event.removed && event.blockHash && event.transactionHash, "Expected a mined event.");
  const receipt = await client.getTransactionReceipt({ hash: event.transactionHash });
  assert.equal(receipt.status, "success");
  assert.equal(receipt.blockHash, event.blockHash, "Event receipt block changed.");
  assert.ok(receipt.logs.some((entry) => sameAddress(entry.address, pins.poolManager.address)
    && entry.logIndex === event.logIndex && entry.data === event.data && entry.topics.join() === event.topics.join()),
  "PoolManager log missing from canonical receipt.");
  return receipt;
}

async function verifyDirectSwap(client, event, poolId, zeroForOne, routerVersion) {
  const receipt = await verifyReceipt(client, event);
  assert.ok(sameAddress(receipt.to, routerVersions[routerVersion].address), "Swap must be a direct Universal Router transaction.");
  const transaction = await client.getTransaction({ hash: event.transactionHash });
  assert.equal(transaction.blockHash, event.blockHash);
  const { args: [commands, inputs, deadline] } = decodeFunctionData({ abi: routerAbi, data: transaction.input });
  assert.equal(commands, "0x10", "Expected a single V4_SWAP command.");
  assert.equal(inputs.length, 1);
  const [actions, parameters] = decodeAbiParameters(actionsInput, inputs[0]);
  assert.equal(actions, "0x060b0f", "Expected SWAP_EXACT_IN_SINGLE, SETTLE, TAKE_ALL.");
  assert.equal(parameters.length, 3);
  const [route] = decodeAbiParameters([swapTuple(routerVersion)], parameters[0]);
  assert.equal(poolIdFor(route.poolKey), poolId, "Router calldata does not reproduce the full guarded PoolKey.");
  assert.equal(route.zeroForOne, zeroForOne);
  assert.equal(route.hookData, "0x");
  const [currencyIn, currencyOut] = zeroForOne
    ? [route.poolKey.currency0, route.poolKey.currency1] : [route.poolKey.currency1, route.poolKey.currency0];
  const [settleCurrency, settleAmount, payerIsUser] = decodeAbiParameters(settleInput, parameters[1]);
  const [takeCurrency, takeMinimum] = decodeAbiParameters(takeAllInput, parameters[2]);
  assert.ok(sameAddress(settleCurrency, currencyIn) && sameAddress(takeCurrency, currencyOut));
  assert.equal(settleAmount, route.amountIn);
  assert.equal(payerIsUser, true);
  assert.equal(takeMinimum, route.amountOutMinimum);
  assert.equal(transaction.value, zeroForOne ? route.amountIn : 0n);
  const { timestamp } = await client.getBlock({ blockHash: event.blockHash });
  assert.ok(deadline >= timestamp, "Router deadline must cover the settled transaction.");
  const [actualInput, actualOutput] = zeroForOne
    ? [-event.args.amount0, event.args.amount1] : [-event.args.amount1, event.args.amount0];
  assert.equal(route.amountIn, actualInput);
  assert.ok(route.amountOutMinimum > 0n && actualOutput >= route.amountOutMinimum, "Router settlement failed its reviewed output bound.");
  if (routerVersion === "2.1.2") {
    assert.ok(route.minHopPriceX36 > 0n && actualOutput * 10n ** 36n / actualInput >= route.minHopPriceX36,
      "Expected a positive per-hop price bound that the swap satisfied.");
  }
  return { transactionHash: event.transactionHash, block: event.blockNumber, input: actualInput, output: actualOutput };
}

async function verify({ rpc, token, guard, start, end, routerVersion }) {
  const client = createPublicClient({ transport: http(rpc.href, { timeout: 10_000, retryCount: 0 }), cacheTime: 0 });
  assert.equal(await client.getChainId(), 31337, "The proof accepts only the local fork chain.");
  const anchor = await client.getBlock({ blockNumber: BigInt(pins.block) });
  assert.equal(anchor.hash, pins.blockHash, "Unexpected Base Sepolia fork anchor.");
  const head = await client.getBlock({ blockNumber: end });
  assert.ok(head.hash && head.number >= start && head.number - start < 256n && start > anchor.number,
    "Use a bounded 256-block range after the pinned Base Sepolia anchor.");
  const blockNumber = head.number;

  const router = routerVersions[routerVersion];
  const dependencies = {
    poolManager: pins.poolManager, positionManager: pins.positionManager, universalRouter: router,
    permit2: pins.permit2, quoter: pins.quoter, stateView: pins.stateView,
  };
  await Promise.all(Object.entries(dependencies).map(async ([name, { address, runtimeHash }]) => {
    const code = await client.getCode({ address, blockNumber });
    assert.ok(code && keccak256(code) === runtimeHash, `Unexpected official ${name} runtime.`);
  }));
  const routerManager = await client.readContract({
    address: router.address, abi: guardAbi, functionName: "poolManager", blockNumber,
  });
  assert.ok(sameAddress(routerManager, pins.poolManager.address), "Router PoolManager binding mismatch.");

  const filter = { address: pins.poolManager.address, fromBlock: start, toBlock: blockNumber, strict: true };
  const pairInitializations = await client.getLogs({
    ...filter, event: initialize, args: { currency0: zeroAddress, currency1: token },
  });
  const guarded = pairInitializations.filter(({ args }) => sameAddress(args.hooks, guard));
  assert.equal(guarded.length, 1, "Exactly one initialization with the supplied guard is required.");
  const initialization = guarded[0];
  const { currency0, currency1, fee, tickSpacing, hooks } = initialization.args;
  const poolKey = { currency0, currency1, fee, tickSpacing, hooks };
  const poolId = poolIdFor(poolKey);
  assert.equal(initialization.args.id, poolId, "Official PoolId must match ABI encoding of the full PoolKey.");
  assert.notEqual(poolIdFor({ ...poolKey, hooks: zeroAddress }), poolId, "The corresponding hookless pool has its own identity.");

  const [manager, factory, launchReceipt] = await Promise.all([
    client.readContract({ address: guard, abi: guardAbi, functionName: "poolManager", blockNumber }),
    client.readContract({ address: guard, abi: guardAbi, functionName: "factory", blockNumber }),
    verifyReceipt(client, initialization),
  ]);
  assert.ok(sameAddress(manager, pins.poolManager.address) && sameAddress(launchReceipt.to, factory), "Guard manager or factory mismatch.");
  const factoryGuard = await client.readContract({ address: factory, abi: factoryAbi, functionName: "initializationGuard", blockNumber });
  assert.ok(sameAddress(factoryGuard, guard), "Factory binding does not match the discovered guard.");

  const stateQuery = { address: pins.stateView.address, abi: stateAbi, args: [poolId], blockNumber };
  const [liquidityLogs, swapLogs, slot0, activeLiquidity] = await Promise.all([
    client.getLogs({ ...filter, event: modifyLiquidity, args: { id: poolId } }),
    client.getLogs({ ...filter, event: swap, args: { id: poolId, sender: router.address } }),
    client.readContract({ ...stateQuery, functionName: "getSlot0" }),
    client.readContract({ ...stateQuery, functionName: "getLiquidity" }),
  ]);
  const positionAdds = liquidityLogs.filter(({ args }) => sameAddress(args.sender, pins.positionManager.address) && args.liquidityDelta > 0n);
  const initialAdd = positionAdds.find((log) => log.transactionHash === initialization.transactionHash && log.logIndex > initialization.logIndex);
  assert.ok(initialAdd, "Canonical launch must fund the guarded pool through the official PositionManager.");
  await verifyReceipt(client, initialAdd);
  assert.ok(activeLiquidity > 0n && slot0[0] > 0n, "StateView must report an initialized and funded pool.");

  const buyEvent = swapLogs.find(({ args }) => args.amount0 < 0n && args.amount1 > 0n);
  const sellEvent = swapLogs.find(({ args }) => args.amount1 < 0n && args.amount0 > 0n);
  assert.ok(buyEvent && sellEvent, "One direct router buy and sell in the observed range are required.");
  const quote = async (zeroForOne, exactAmount) => {
    const { result: [output] } = await client.simulateContract({
      address: pins.quoter.address, abi: quoterAbi, functionName: "quoteExactInputSingle",
      args: [{ poolKey, zeroForOne, exactAmount, hookData: "0x" }], blockNumber,
    });
    assert.ok(output > 0n, "Expected a positive official quote.");
    return { input: exactAmount, output };
  };
  const [buy, sell, buyQuote, sellQuote] = await Promise.all([
    verifyDirectSwap(client, buyEvent, poolId, true, routerVersion), verifyDirectSwap(client, sellEvent, poolId, false, routerVersion),
    quote(true, parseEther("0.001")), quote(false, parseEther("1")),
  ]);
  const observedAgain = await client.getBlock({ blockNumber });
  assert.equal(observedAgain.hash, head.hash, "Evidence snapshot changed during verification.");

  return {
    chainId: 31337,
    forkAnchor: { chainId: pins.chainId, block: anchor.number, hash: anchor.hash },
    observation: { block: head.number, hash: head.hash },
    poolManager: pins.poolManager.address,
    universalRouter: { address: router.address, version: routerVersion, runtimeHash: router.runtimeHash },
    quoter: pins.quoter.address,
    positionManager: pins.positionManager.address,
    stateView: pins.stateView.address,
    poolKey, poolId, factory,
    initialize: { transactionHash: initialization.transactionHash, block: initialization.blockNumber },
    liquidity: { initial: initialAdd.args.liquidityDelta, activeAtObservation: activeLiquidity, positivePositionManagerEvents: positionAdds.length },
    quotes: { buy: buyQuote, sell: sellQuote },
    directRouterSettlements: { buy, sell },
  };
}

const proof = await verify(configuration(process.argv.slice(2)));
process.stdout.write(`${JSON.stringify(proof, (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`);
