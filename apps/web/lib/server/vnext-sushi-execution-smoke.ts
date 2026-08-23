import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, zeroAddress, type Address, type Hex } from "viem";
import { SUSHI_RED_SNWAPPER, type SushiAssetExecutableQuote } from "../sushi";
import {
  SUSHI_ROUTE_EXECUTOR,
  sushiRedSnwapperAbi,
  sushiRouteAsset
} from "../vnext/sushi-authorization-codec";
import { prepareVNextSushiAuthorization, verifyVNextSushiRoute, type VNextSushiExecutionDependencies } from "./vnext-sushi-execution";

const tokenA = getAddress("0x1111111111111111111111111111111111111111");
const tokenB = getAddress("0x2222222222222222222222222222222222222222");
const wallet = getAddress("0x3333333333333333333333333333333333333333");
const amountIn = 100n;
const nowMs = Date.now();

function executable(input: {
  inputAsset: Address;
  outputAsset: Address;
  recipient: Address;
  amountIn: bigint;
}, overrides: Partial<{ minimumOut: bigint; tokenIn: Address; tokenOut: Address; recipient: Address; executor: Address; value: bigint; expiresAt: bigint }> = {}): SushiAssetExecutableQuote {
  const minimumOut = overrides.minimumOut ?? 990n;
  const data = encodeFunctionData({
    abi: sushiRedSnwapperAbi,
    functionName: "snwap",
    args: [
      overrides.tokenIn ?? sushiRouteAsset(input.inputAsset),
      input.amountIn,
      overrides.recipient ?? input.recipient,
      overrides.tokenOut ?? sushiRouteAsset(input.outputAsset),
      minimumOut,
      overrides.executor ?? SUSHI_ROUTE_EXECUTOR,
      "0x6be92b8900"
    ]
  });
  return {
    chainId: 4_663,
    venue: "sushi-aggregator",
    protocol: "SUSHI",
    inputAsset: input.inputAsset,
    outputAsset: input.outputAsset,
    recipient: input.recipient,
    amountIn: input.amountIn.toString(),
    quoteOut: "1000",
    minimumOut: minimumOut.toString(),
    priceImpact: 0.5,
    inputToken: { address: sushiRouteAsset(input.inputAsset), symbol: "IN", name: "Input", decimals: 18 },
    outputToken: { address: sushiRouteAsset(input.outputAsset), symbol: "OUT", name: "Output", decimals: 18 },
    router: SUSHI_RED_SNWAPPER,
    executor: SUSHI_ROUTE_EXECUTOR,
    calldata: data,
    value: (overrides.value ?? (input.inputAsset === zeroAddress ? input.amountIn : 0n)).toString(),
    quoteExpiresAt: (overrides.expiresAt ?? BigInt(Math.floor(nowMs / 1_000) + 90)).toString(),
    executable: true,
    onchainDeadline: false,
    verifiedInput: true
  };
}

function dependencies(input: {
  balance?: bigint;
  allowance?: bigint;
  nativeBalance?: bigint;
  callFails?: boolean;
  estimateFails?: boolean;
  mutate?: Parameters<typeof executable>[1];
} = {}) {
  const calls: { account: Address; to: Address; data: Hex; value: bigint }[] = [];
  const deps: VNextSushiExecutionDependencies = {
    build: async (request) => executable(request, input.mutate),
    rpc: {
      getBalance: async () => input.nativeBalance ?? 1_000_000n,
      getGasPrice: async () => 2n,
      readBalance: async () => input.balance ?? 1_000n,
      readAllowance: async () => input.allowance ?? 1_000n,
      async call(request) {
        calls.push(request);
        if (input.callFails) throw new Error("eth_call failed");
      },
      async estimateGas() {
        if (input.estimateFails) throw new Error("estimate failed");
        return 100n;
      }
    }
  };
  return { deps, calls };
}

function request(inputAsset: Address, outputAsset: Address) {
  return {
    chainId: 4_663 as const,
    inputAsset,
    outputAsset,
    inputAmountAtomic: amountIn.toString(),
    amountIn,
    recipient: wallet,
    indicativeProtectedOutputFloorAtomic: 980n
  };
}

async function main() {
  const nativeDeps = dependencies();
  const native = await verifyVNextSushiRoute(request(zeroAddress, tokenA), nativeDeps.deps);
  assert.equal(native.status, "verified");
  assert.equal(native.approvalRequired, false);
  assert.equal(native.transactionValueAtomic, amountIn.toString());
  assert.equal(native.onchainDeadline, false);
  assert.equal(native.freshnessKind, "server_authorization_expiry");
  assert.equal(native.rmtFeeEnabled, false);
  assert.equal(native.netEconomics.rmtFee.state, "disabled");
  assert.equal(nativeDeps.calls.length, 1);
  assert.equal(nativeDeps.calls[0].to, SUSHI_RED_SNWAPPER);

  const nativeOutput = await verifyVNextSushiRoute(request(tokenA, zeroAddress), dependencies().deps);
  assert.equal(nativeOutput.status, "verified");
  assert.equal(nativeOutput.transactionValueAtomic, "0");

  const tokenToToken = await verifyVNextSushiRoute(request(tokenA, tokenB), dependencies().deps);
  assert.equal(tokenToToken.status, "verified");

  const approvalDeps = dependencies({ allowance: 0n });
  const approvalEvidence = await verifyVNextSushiRoute(request(tokenA, tokenB), approvalDeps.deps);
  assert.equal(approvalEvidence.status, "approval_required");
  assert.equal(approvalEvidence.approvalSpender, SUSHI_RED_SNWAPPER);
  assert.equal(approvalEvidence.exactSimulationPassed, false);
  const approval = await prepareVNextSushiAuthorization({
    ...request(tokenA, tokenB),
    deadlineSeconds: BigInt(Math.floor(nowMs / 1_000) + 90),
    protectedOutputFloorAtomic: 990n,
    nowMs
  }, dependencies({ allowance: 0n }).deps);
  assert.equal(approval.transaction.kind, "erc20_approval");
  assert.equal(approval.transaction.target, tokenA);
  const decodedApproval = decodeFunctionData({ abi: erc20Abi, data: approval.transaction.data });
  assert.equal(decodedApproval.functionName, "approve");
  assert.equal(decodedApproval.args[0], SUSHI_RED_SNWAPPER);
  assert.equal(decodedApproval.args[1], amountIn);

  const direct = await prepareVNextSushiAuthorization({
    ...request(tokenA, tokenB),
    deadlineSeconds: BigInt(Math.floor(nowMs / 1_000) + 90),
    protectedOutputFloorAtomic: 990n,
    nowMs
  }, dependencies().deps);
  assert.equal(direct.transaction.kind, "swap");

  assert.equal((await verifyVNextSushiRoute(request(tokenA, tokenB), dependencies({ callFails: true }).deps)).status, "simulation_failed");
  assert.equal((await verifyVNextSushiRoute(request(tokenA, tokenB), dependencies({ balance: 99n }).deps)).status, "insufficient_balance");
  assert.equal((await verifyVNextSushiRoute(request(tokenA, tokenB), dependencies({ estimateFails: true }).deps)).status, "gas_unavailable");
  await assert.rejects(prepareVNextSushiAuthorization({
    ...request(tokenA, tokenB),
    deadlineSeconds: BigInt(Math.floor(nowMs / 1_000) + 5),
    protectedOutputFloorAtomic: 990n,
    nowMs
  }, dependencies().deps), /server authorization expiry is stale/);
  await assert.rejects(verifyVNextSushiRoute({ ...request(tokenA, tokenB), chainId: 1 as 4_663 }, dependencies().deps), /mainnet/);
  await assert.rejects(verifyVNextSushiRoute(request(tokenA, tokenB), dependencies({ mutate: { tokenOut: wallet } }).deps), /output token/);
  await assert.rejects(verifyVNextSushiRoute(request(tokenA, tokenB), dependencies({ mutate: { recipient: tokenB } }).deps), /recipient/);
  await assert.rejects(verifyVNextSushiRoute(request(tokenA, tokenB), dependencies({ mutate: { executor: wallet } }).deps), /route executor/);
  await assert.rejects(verifyVNextSushiRoute(request(zeroAddress, tokenA), dependencies({ mutate: { value: 0n } }).deps), /native transaction value/);
  await assert.rejects(verifyVNextSushiRoute(request(tokenA, tokenB), dependencies({ mutate: { minimumOut: 0n } }).deps), /minimum received|inconsistent executable/);
  await assert.rejects(verifyVNextSushiRoute({ ...request(tokenA, tokenB), indicativeProtectedOutputFloorAtomic: 991n }, dependencies().deps), /protected-output floor/);

  console.log("RMT VNext Sushi wallet execution and adversarial preflight checks passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
