import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, isAddress, keccak256, parseAbi, parseAbiItem, zeroAddress } = requireWeb("viem");
const { baseSepolia } = JSON.parse(readFileSync(
  new URL("../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json", import.meta.url), "utf8",
));
const router = baseSepolia.universalRouter212.address;
const keyType = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const keyTuple = parseAbiItem(`function key(${keyType} poolKey)`).inputs[0];
const swapTuple = parseAbiItem(`function params((${keyType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData) swap)`).inputs[0];
const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const actionTypes = [{ type: "bytes" }, { type: "bytes[]" }];
const settleTypes = [{ type: "address" }, { type: "uint256" }, { type: "bool" }];
const takeTypes = [{ type: "address" }, { type: "uint256" }];
const same = (left, right) => typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
const poolId = (key) => keccak256(encodeAbiParameters([keyTuple], [key]));
const unknown = (reason) => ({ status: "unknown", reason });

function observationTime(capture, nowMs) {
  if (typeof capture?.observedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(capture.observedAt)) return;
  const time = Date.parse(capture.observedAt);
  return Number.isFinite(time) && time <= nowMs && nowMs - time <= 10 * 60_000 ? time : undefined;
}

function checkRoute(expected, capture, nowMs, buy) {
  const time = observationTime(capture, nowMs);
  if (time === undefined) return unknown("Quote missing or stale.");
  try {
    const { routing, swapTransaction: tx } = capture.response;
    if (routing !== "CLASSIC" || tx?.chainId !== expected.chainId || !same(tx.to, router)
      || typeof tx.data !== "string" || tx.data.length > 16_384) return unknown("Expected a supported Classic router transaction.");
    const { args: [commands, inputs, deadline] } = decodeFunctionData({ abi: routerAbi, data: tx.data });
    if (commands !== "0x10" || inputs.length !== 1 || deadline <= BigInt(Math.floor(nowMs / 1000))) {
      return unknown("Expected a fresh single V4_SWAP command.");
    }
    const [actions, parameters] = decodeAbiParameters(actionTypes, inputs[0]);
    if (actions !== "0x060b0f" || parameters.length !== 3) {
      return unknown("Expected a single exact-input v4 hop with the reviewed settlement actions.");
    }
    const [hop] = decodeAbiParameters([swapTuple], parameters[0]);
    const [currencyIn, currencyOut] = buy ? [expected.poolKey.currency0, expected.poolKey.currency1]
      : [expected.poolKey.currency1, expected.poolKey.currency0];
    const [settleCurrency, settleAmount, payerIsUser] = decodeAbiParameters(settleTypes, parameters[1]);
    const [takeCurrency, takeMinimum] = decodeAbiParameters(takeTypes, parameters[2]);
    if (!same(poolId(hop.poolKey), expected.poolId) || hop.zeroForOne !== buy || hop.hookData !== "0x"
      || hop.amountIn <= 0n || hop.amountOutMinimum <= 0n || hop.minHopPriceX36 <= 0n
      || !same(settleCurrency, currencyIn) || !same(takeCurrency, currencyOut)
      || settleAmount !== hop.amountIn || takeMinimum !== hop.amountOutMinimum || !payerIsUser
      || typeof tx.value !== "string" || BigInt(tx.value) !== (buy ? hop.amountIn : 0n)) {
      return unknown("The quote did not prove the exact guarded key and protected direction.");
    }
    return { status: "payload_matches", observedAt: new Date(time).toISOString(), deadlineUnixSeconds: deadline.toString() };
  } catch {
    return unknown("Quote response could not be decoded.");
  }
}

function checkPoolData(expected, capture, nowMs) {
  const time = observationTime(capture, nowMs);
  if (time === undefined) return unknown("Pool response missing or stale.");
  const pools = capture.response?.pools;
  if (!Array.isArray(pools) || pools.length > 20) return unknown("Expected a bounded Uniswap Pool Info response.");
  const key = expected.poolKey;
  const matches = pools.filter((pool) => pool?.chainId === expected.chainId && pool.poolProtocol === "V4"
    && same(pool.poolReferenceIdentifier, expected.poolId) && same(pool.tokenAddressA, key.currency0)
    && same(pool.tokenAddressB, key.currency1) && same(pool.hookAddress, key.hooks)
    && pool.tickSpacing === key.tickSpacing && String(pool.fee) === String(key.fee));
  return matches.length === 1 ? { status: "payload_matches", observedAt: new Date(time).toISOString() }
    : unknown("The response did not contain one exact chain and guarded pool match.");
}

export function verifyHostedV4Observation(input, nowMs = Date.now()) {
  const expected = input?.expected;
  const key = expected?.poolKey;
  // Base Sepolia is the only supported capture profile with reviewed deployment pins in this candidate.
  if (expected?.chainId !== baseSepolia.chainId || !same(expected.poolManager, baseSepolia.poolManager.address)
    || !same(key?.currency0, zeroAddress) || !isAddress(key?.currency1 ?? "") || same(key.currency1, zeroAddress)
    || !isAddress(key.hooks ?? "") || (BigInt(key.hooks) & 0x3fffn) !== 0x2000n || key.fee !== 3000
    || key.tickSpacing !== 60 || !same(expected.poolId, poolId(key))) {
    throw new Error("Expected an exact guarded Base Sepolia pool with the reviewed manager.");
  }
  return {
    chainId: expected.chainId, poolManager: baseSepolia.poolManager.address, poolId: expected.poolId,
    router, buy: checkRoute(expected, input.buy, nowMs, true), sell: checkRoute(expected, input.sell, nowMs, false),
    uniswapPoolData: checkPoolData(expected, input.poolInfo, nowMs),
    independentHostedIndexing: unknown("This profile has no supported independent hosted indexer."),
    provenance: "offline_payload_validation_only",
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const path = process.argv[2];
  if (process.argv.length !== 3 || !statSync(path).isFile() || statSync(path).size > 1024 * 1024) {
    throw new Error("Supply one local JSON capture of at most 1 MiB.");
  }
  const result = verifyHostedV4Observation(JSON.parse(readFileSync(path, "utf8")));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
