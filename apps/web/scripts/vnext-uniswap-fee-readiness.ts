import {
  configuredVNextUniswapFeeExecutor,
  verifyConfiguredVNextUniswapFeeExecutor,
  verifyVNextUniswapFeeInfrastructure
} from "../lib/server/vnext-uniswap-fee-executor";
import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  getAddress,
  http,
  parseAbi
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  RMT_UNISWAP_V3_FEE_MAINNET_PROOF,
  assertRmtUniswapV3FeeMainnetProof
} from "../lib/vnext/uniswap-v3-fee-mainnet-proof";
import { rmtUniswapV3FeeExecutorAbi } from "../lib/vnext/uniswap-v3-fee-executor";

const proofViewAbi = parseAbi(["function executionConsumed(bytes32 executionId) view returns (bool)"]);

async function verifyLiveMainnetProof() {
  const proof = RMT_UNISWAP_V3_FEE_MAINNET_PROOF;
  assertRmtUniswapV3FeeMainnetProof(proof);
  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(
      process.env.RMT_MAINNET_RPC_URL
        ?? process.env.ROBINHOOD_MAINNET_RPC_URL
        ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
        ?? robinhoodChain.rpcUrls.default.http[0],
      { retryCount: 2, timeout: 8_000, batch: { batchSize: 20, wait: 0 } }
    )
  });
  const proofBlock = BigInt(proof.blockNumber);
  const previousBlock = proofBlock - 1n;
  const [receipt, currentBlock] = await Promise.all([
    client.getTransactionReceipt({ hash: proof.transactionHash }),
    client.getBlockNumber()
  ]);
  if (
    receipt.status !== "success"
    || receipt.blockNumber !== proofBlock
    || receipt.blockHash.toLowerCase() !== proof.blockHash.toLowerCase()
    || receipt.transactionIndex !== proof.transactionIndex
    || getAddress(receipt.from) !== proof.trader
    || !receipt.to || getAddress(receipt.to) !== proof.executor
    || receipt.gasUsed.toString() !== proof.gasUsed
    || receipt.effectiveGasPrice.toString() !== proof.effectiveGasPriceWei
  ) throw new Error("controlled mainnet proof receipt changed");
  const settlements = receipt.logs.flatMap((log) => {
    if (getAddress(log.address) !== proof.executor) return [];
    try {
      const decoded = decodeEventLog({
        abi: rmtUniswapV3FeeExecutorAbi,
        eventName: "RMTUniswapV3FeeSettled",
        data: log.data,
        topics: log.topics
      });
      return decoded.eventName === "RMTUniswapV3FeeSettled" ? [decoded.args] : [];
    } catch {
      return [];
    }
  });
  if (settlements.length !== proof.settlementEventCount) throw new Error("controlled mainnet proof settlement is not unique");
  const settlement = settlements[0];
  if (
    settlement.executionId.toLowerCase() !== proof.executionId.toLowerCase()
    || settlement.policyIdHash.toLowerCase() !== proof.policyIdHash.toLowerCase()
    || settlement.policyVersion !== BigInt(proof.policyVersion)
    || settlement.policyHash.toLowerCase() !== proof.policyHash.toLowerCase()
    || settlement.providerId.toLowerCase() !== proof.providerId.toLowerCase()
    || getAddress(settlement.router) !== proof.router
    || settlement.routeIdentity.toLowerCase() !== proof.routeIdentity.toLowerCase()
    || getAddress(settlement.feeAsset) !== proof.inputAsset
    || Number(settlement.feeBps) !== proof.feeBps
    || Number(settlement.feeSide) !== 0
    || settlement.userGrossInput.toString() !== proof.userGrossInputAtomic
    || settlement.providerInput.toString() !== proof.providerInputAtomic
    || settlement.grossActualOutput.toString() !== proof.grossActualOutputAtomic
    || settlement.actualRmtFee.toString() !== proof.actualRmtFeeAtomic
    || settlement.actualUserNetOutput.toString() !== proof.actualUserNetOutputAtomic
    || getAddress(settlement.trader) !== proof.trader
    || getAddress(settlement.treasury) !== proof.treasury
  ) throw new Error("controlled mainnet proof settlement fields changed");
  const transfers = receipt.logs.flatMap((log) => {
    if (getAddress(log.address) !== proof.inputAsset && getAddress(log.address) !== proof.outputAsset) return [];
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics });
      return decoded.eventName === "Transfer" ? [{ token: getAddress(log.address), ...decoded.args }] : [];
    } catch {
      return [];
    }
  });
  const exactTransfer = (token: string, from: string, to: string, value: string) => transfers.filter((transfer) => (
    transfer.token === getAddress(token)
    && getAddress(transfer.from) === getAddress(from)
    && getAddress(transfer.to) === getAddress(to)
    && transfer.value.toString() === value
  )).length === 1;
  if (
    !exactTransfer(proof.inputAsset, proof.trader, proof.executor, proof.userGrossInputAtomic)
    || !exactTransfer(proof.outputAsset, proof.pool, proof.trader, proof.actualUserNetOutputAtomic)
    || !exactTransfer(proof.inputAsset, proof.executor, proof.treasury, proof.actualRmtFeeAtomic)
  ) throw new Error("controlled mainnet proof token transfers changed");
  const readBalance = (token: `0x${string}`, owner: `0x${string}`, blockNumber?: bigint) => client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
    ...(blockNumber === undefined ? {} : { blockNumber })
  });
  const [executorInput, executorOutput, routerAllowance, executionConsumed] = await Promise.all([
    readBalance(proof.inputAsset, proof.executor),
    readBalance(proof.outputAsset, proof.executor),
    client.readContract({ address: proof.inputAsset, abi: erc20Abi, functionName: "allowance", args: [proof.executor, proof.router] }),
    client.readContract({ address: proof.executor, abi: proofViewAbi, functionName: "executionConsumed", args: [proof.executionId] })
  ]);
  if (
    executorInput.toString() !== proof.executorPostState.inputAssetAtomic
    || executorOutput.toString() !== proof.executorPostState.outputAssetAtomic
    || routerAllowance.toString() !== proof.executorPostState.routerAllowanceAtomic
    || executionConsumed !== proof.executorPostState.executionConsumed
  ) throw new Error("controlled mainnet proof executor residual or replay state changed");
  let historicalBalanceReplay: { status: "verified" } | { status: "unavailable"; reason: string } = { status: "verified" };
  try {
    const [
      preUsdg, postUsdg, preWeth, postWeth, preNative, postNative,
      treasuryPre, treasuryPost
    ] = await Promise.all([
      readBalance(proof.inputAsset, proof.trader, previousBlock),
      readBalance(proof.inputAsset, proof.trader, proofBlock),
      readBalance(proof.outputAsset, proof.trader, previousBlock),
      readBalance(proof.outputAsset, proof.trader, proofBlock),
      client.getBalance({ address: proof.trader, blockNumber: previousBlock }),
      client.getBalance({ address: proof.trader, blockNumber: proofBlock }),
      readBalance(proof.inputAsset, proof.treasury, previousBlock),
      readBalance(proof.inputAsset, proof.treasury, proofBlock)
    ]);
    const expected = proof.walletBalances;
    if (
      preUsdg.toString() !== expected.preUsdgAtomic || postUsdg.toString() !== expected.postUsdgAtomic
      || preWeth.toString() !== expected.preWethAtomic || postWeth.toString() !== expected.postWethAtomic
      || preNative.toString() !== expected.preNativeWei || postNative.toString() !== expected.postNativeWei
      || treasuryPre.toString() !== proof.treasuryBalances.preFeeAssetAtomic
      || treasuryPost.toString() !== proof.treasuryBalances.postFeeAssetAtomic
    ) throw new Error("controlled mainnet proof historical balances changed");
  } catch (cause) {
    historicalBalanceReplay = {
      status: "unavailable",
      reason: cause instanceof Error && /metadata is not found/i.test(cause.message)
        ? "default RPC no longer retains the proof block's historical balance metadata; receipt transfer evidence remains verified"
        : cause instanceof Error ? cause.message : "historical balance replay unavailable"
    };
  }
  const confirmations = currentBlock >= proofBlock ? currentBlock - proofBlock + 1n : 0n;
  if (confirmations < BigInt(proof.minimumConfirmations)) throw new Error("controlled mainnet proof lacks finality");
  return {
    transactionHash: proof.transactionHash,
    blockNumber: proof.blockNumber,
    confirmations: confirmations.toString(),
    receiptAndTransfersVerified: true,
    executorStateVerified: true,
    historicalBalanceReplay
  };
}

async function main() {
  const blockers: string[] = [];
  const policyGate = process.env.RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED === "true";
  const providerGate = process.env.RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED === "true";
  const publicReleaseGate = process.env.RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED === "true";
  const globalServerGate = process.env.RMT_VNEXT_AUTHORIZATION_ENABLED === "true";
  const globalClientGate = process.env.NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED === "true";
  const walletSubmissionGate = process.env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED === "true";
  let configured: ReturnType<typeof configuredVNextUniswapFeeExecutor> = null;
  let deployment: Awaited<ReturnType<typeof verifyConfiguredVNextUniswapFeeExecutor>> | null = null;
  let infrastructure: Awaited<ReturnType<typeof verifyVNextUniswapFeeInfrastructure>> | null = null;
  let mainnetProof: Awaited<ReturnType<typeof verifyLiveMainnetProof>> | null = null;
  try {
    mainnetProof = await verifyLiveMainnetProof();
  } catch (cause) {
    blockers.push(cause instanceof Error ? cause.message : "controlled mainnet proof verification failed");
  }
  try {
    infrastructure = await verifyVNextUniswapFeeInfrastructure();
  } catch (cause) {
    blockers.push(cause instanceof Error ? cause.message : "fee infrastructure verification failed");
  }
  try {
    configured = configuredVNextUniswapFeeExecutor();
    if (configured) deployment = await verifyConfiguredVNextUniswapFeeExecutor(configured);
  } catch (cause) {
    blockers.push(cause instanceof Error ? cause.message : "fee executor verification failed");
  }
  if (!policyGate) blockers.push("fee policy gate is off");
  if (!providerGate) blockers.push("Uniswap V3 fee authorization gate is off");
  if (!publicReleaseGate) blockers.push("public fee authorization gate is off");
  if (!globalServerGate || !globalClientGate) blockers.push("global wallet authorization gates are not both enabled");
  if (!walletSubmissionGate) blockers.push("wallet submission gate is off");
  if (!configured) blockers.push("exact policy and executor constructor values are not configured");
  if (!deployment) blockers.push("executor deployment and immutable runtime verification are incomplete");
  console.log(JSON.stringify({
    chainId: 4_663,
    provider: "uniswap-v3",
    settlementMode: "rmt-direct-executor-v1",
    executor: configured?.executor ?? null,
    executorRuntimeHash: configured?.executorRuntimeHash ?? null,
    treasury: configured?.policy.treasury ?? null,
    policyId: configured?.policy.policyId ?? null,
    policyVersion: configured?.policy.version ?? null,
    policyHash: configured?.policy.policyHash ?? null,
    feeBps: configured?.policy.feeBps ?? null,
    effectiveBoundary: configured?.policy.effectiveBoundary ?? null,
    eligibleSettlementAssetIds: configured?.policy.eligibleSettlementAssetIds ?? [],
    releaseScope: configured?.releaseScope ?? "disabled",
    proofWalletRestricted: configured?.releaseScope === "proof-wallet",
    mainnetProof,
    infrastructure,
    deploymentVerifiedAtBlock: deployment?.verifiedAtBlock ?? null,
    gates: { policyGate, providerGate, publicReleaseGate, globalServerGate, globalClientGate, walletSubmissionGate },
    releaseReady: blockers.length === 0,
    blockers
  }, null, 2));
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
