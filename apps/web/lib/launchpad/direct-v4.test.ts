import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  decodeAbiParameters, decodeFunctionData, parseAbi, parseAbiItem, toHex, zeroAddress,
  type Address, type PublicClient, type TransactionReceipt,
} from "viem";
import { baseSepolia } from "../../../../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json";
import { readLaunchpadRuntime } from "../server/new-launchpad-config";
import { boundReceipt, prepareSwap, verifySwap } from "./direct-v4";
import { launchPoolId, type NewLaunchRecord } from "./launch-record";
import { launchpadRouterPins } from "./router-pins";
import type { BoundWallet, WalletProvider } from "./transactions";

const hash = (n: number) => toHex(n, { size: 32 });
const address = (n: number): Address => toHex(n, { size: 20 });
const env = {
  RMT_LAUNCHPAD_ENABLED: "true",
  RMT_LAUNCHPAD_TRADING_ENABLED: "true",
  RMT_LAUNCHPAD_CHAIN_ID: "31337",
  RMT_LAUNCHPAD_ENGINE_VERSION: "2",
  RMT_LAUNCHPAD_RPC_URL: "http://127.0.0.1:8545",
  RMT_LAUNCHPAD_FACTORY_ADDRESS: address(1),
  RMT_LAUNCHPAD_FACTORY_RUNTIME_HASH: hash(1),
  RMT_LAUNCHPAD_FACTORY_START_BLOCK: String(baseSepolia.block + 2),
  RMT_LAUNCHPAD_GUARD_ADDRESS: address(0x2000),
  RMT_LAUNCHPAD_GUARD_RUNTIME_HASH: hash(2),
  RMT_LAUNCHPAD_DATABASE_PATH: resolve("launchpad-fixture.sqlite"),
};
const legacy = readLaunchpadRuntime(env)!;
const candidate = readLaunchpadRuntime({ ...env, RMT_LAUNCHPAD_ROUTER_VERSION: "2.1.2" })!;
const account = address(3);
const token = address(4);
const poolKey = { currency0: zeroAddress, currency1: token, hooks: address(0x2000), fee: 3000, tickSpacing: 60 };
const blockHash = hash(5);
const txHash = hash(6);
const launch: NewLaunchRecord = {
  chainId: 31337, engineVersion: 2, creator: account, factory: candidate.deployment.factory,
  token, poolManager: candidate.deployment.poolManager, poolId: launchPoolId(poolKey), poolKey,
  intentId: hash(7), positionTokenId: "1", sqrtPriceX96: "1", tickLower: -887220, tickUpper: 887220,
  liquidity: "1", amount0: "1", amount1: "1", totalSupply: "10", name: "Review fixture", symbol: "FIX",
  projectURI: "", transactionHash: txHash, blockNumber: "10", blockHash, logIndex: 0, indexing: "indexed",
};
const provider: WalletProvider = { request: async () => undefined, on() {}, removeListener() {} };
const wallet: BoundWallet = { address: account, chainId: 31337, provider, request: provider.request, generation: 1 };
const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const permitAbi = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]);
const swap212 = parseAbiItem("function single(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData) params)").inputs[0];
const swap20 = parseAbiItem("function single(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData) params)").inputs[0];
const exactInput = 91n;

function rpc({ routerAllowance = exactInput, quote = 101n } = {}) {
  return {
    async getChainId() { return 31337; },
    async getBlock() { return { number: 10n, hash: blockHash }; },
    async getBalance() { return 10n ** 45n; },
    async getGasPrice() { return 1n; },
    async estimateGas() { return 1n; },
    async call() { return {}; },
    async simulateContract() { return { result: [quote] }; },
    async readContract({ address: target, functionName }: { address: Address; functionName: string }) {
      if (functionName === "balanceOf") return exactInput;
      if (target === candidate.deployment.permit2) return [routerAllowance, Math.floor(Date.now() / 1000) + 300];
      return exactInput;
    },
  } as unknown as PublicClient;
}

test("opts into the exact guarded 2.1.2 router without rescoping the launch database", () => {
  assert.deepEqual(candidate.contracts.universalRouter, launchpadRouterPins["2.1.2"]);
  assert.deepEqual(legacy.contracts.universalRouter, launchpadRouterPins["2.0"]);
  assert.equal(candidate.scope, legacy.scope);
  assert.throws(() => readLaunchpadRuntime({
    ...env, RMT_LAUNCHPAD_ROUTER_VERSION: "2.1.2", RMT_LAUNCHPAD_ENGINE_VERSION: "1",
  }), /direct loopback V2/);
  assert.throws(() => readLaunchpadRuntime({
    ...env, RMT_LAUNCHPAD_ROUTER_VERSION: "2.1.2", RMT_LAUNCHPAD_PREVIEW_ORIGIN: "https://preview.example",
  }), /direct loopback V2/);
  assert.throws(() => readLaunchpadRuntime({ ...env, RMT_LAUNCHPAD_ROUTER_VERSION: "2.1.1" }), /Invalid RMT_LAUNCHPAD_ROUTER_VERSION/);
});

test("encodes both exact-input versions and a positive 2.1.2 hop floor with the full PoolKey", async () => {
  for (const [runtime, side] of [[legacy, "buy"], [candidate, "buy"], [candidate, "sell"]] as const) {
    const review = await prepareSwap(rpc(), runtime.deployment, wallet, launch, side, exactInput, 100);
    assert.equal(review.request.to, runtime.deployment.universalRouter);
    const { args: [commands, inputs, deadline] } = decodeFunctionData({ abi: routerAbi, data: review.request.data });
    assert.equal(commands, "0x10");
    assert.equal(deadline, BigInt(review.deadline));
    assert.equal(inputs.length, 1);
    const [actions, args] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], inputs[0]);
    assert.equal(actions, "0x060b0f");
    assert.equal(args.length, 3);
    const [swap] = runtime === candidate ? decodeAbiParameters([swap212], args[0]) : decodeAbiParameters([swap20], args[0]);
    assert.deepEqual(swap.poolKey, poolKey);
    assert.equal(swap.zeroForOne, side === "buy");
    assert.equal(swap.amountIn, exactInput);
    assert.equal(swap.amountOutMinimum, 99n);
    assert.equal(swap.hookData, "0x");
    assert.equal("minHopPriceX36" in swap, runtime === candidate);
    if ("minHopPriceX36" in swap) assert.equal(swap.minHopPriceX36, 99n * 10n ** 36n / exactInput);
    const [currencyIn, settled, payerIsUser] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], args[1]);
    const [currencyOut, taken] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], args[2]);
    assert.equal(currencyIn, side === "buy" ? zeroAddress : token);
    assert.equal(currencyOut, side === "buy" ? token : zeroAddress);
    assert.equal(settled, exactInput);
    assert.equal(taken, 99n);
    assert.equal(payerIsUser, true);
    assert.equal(BigInt(review.request.value), side === "buy" ? exactInput : 0n);
  }
});

test("requires a nonzero hop floor and exact version-specific Permit2 authorization", async () => {
  await assert.rejects(() => prepareSwap(rpc({ quote: 2n }), candidate.deployment, wallet, launch, "buy", 1n << 126n, 100),
    /minimum per-hop price/);
  const review = await prepareSwap(rpc({ routerAllowance: 0n }), candidate.deployment, wallet, launch, "sell", exactInput, 100);
  assert.equal(review.request.kind, "router-approval");
  assert.equal(review.request.to, candidate.deployment.permit2);
  const { args } = decodeFunctionData({ abi: permitAbi, data: review.request.data });
  assert.deepEqual(args, [token, launchpadRouterPins["2.1.2"].address, exactInput, review.deadline]);
});

test("recovers only from the reviewed chain, original block, and exact transaction", async () => {
  const { request } = await prepareSwap(rpc(), candidate.deployment, wallet, launch, "buy", exactInput, 100);
  const tx = { hash: txHash, from: account, to: request.to, input: request.data, value: exactInput, blockHash: hash(10), blockNumber: 11n };
  const receipt = { transactionHash: txHash, blockNumber: 11n, blockHash: tx.blockHash, from: account, to: request.to };
  const receiptRpc = (chainId: number, reviewed: typeof blockHash, input = tx.input, wrongBlockNumber = false) => ({
    async getChainId() { return chainId; },
    async getTransaction() { return { ...tx, input }; },
    async getTransactionReceipt() { return receipt; },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return { number: wrongBlockNumber ? blockNumber + 1n : blockNumber, hash: blockNumber === 10n ? reviewed : tx.blockHash };
    },
  }) as unknown as PublicClient;
  assert.equal(await boundReceipt(receiptRpc(31337, blockHash), txHash, request), receipt);
  await assert.rejects(() => boundReceipt(receiptRpc(84532, blockHash), txHash, request), /different network/);
  await assert.rejects(() => boundReceipt(receiptRpc(31337, hash(11)), txHash, request), /reviewed network block changed/);
  await assert.rejects(() => boundReceipt(receiptRpc(31337, blockHash, tx.input, true), txHash, request), /receipt block changed/);
  await assert.rejects(() => boundReceipt(receiptRpc(31337, blockHash, "0x1234"), txHash, request), /does not match/);
});

test("checks a prior router journal against its original pin after changing the active router", async () => {
  const { request } = await prepareSwap(rpc(), legacy.deployment, wallet, launch, "buy", exactInput, 100);
  const receipt = { from: account, to: request.to, status: "success", blockNumber: 11n } as TransactionReceipt;
  let checked: Address | undefined;
  const client = { async getCode({ address: target }: { address: Address }) { checked = target; return "0x6000"; } } as unknown as PublicClient;
  await assert.rejects(() => verifySwap(client, receipt, candidate.deployment, launch, request), /receipt router runtime/);
  assert.equal(checked, launchpadRouterPins["2.0"].address);
  await assert.rejects(() => verifySwap(client, receipt, candidate.deployment, launch, { ...request, data: "0x1234" }),
    /does not match the reviewed pool swap/);
});
