import {
  configuredVNextUniswapFeeExecutor,
  verifyConfiguredVNextUniswapFeeExecutor,
  verifyVNextUniswapFeeInfrastructure
} from "../lib/server/vnext-uniswap-fee-executor";

async function main() {
  const blockers: string[] = [];
  const policyGate = process.env.RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED === "true";
  const providerGate = process.env.RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED === "true";
  const globalServerGate = process.env.RMT_VNEXT_AUTHORIZATION_ENABLED === "true";
  const globalClientGate = process.env.NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED === "true";
  const walletSubmissionGate = process.env.NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED === "true";
  let configured: ReturnType<typeof configuredVNextUniswapFeeExecutor> = null;
  let deployment: Awaited<ReturnType<typeof verifyConfiguredVNextUniswapFeeExecutor>> | null = null;
  let infrastructure: Awaited<ReturnType<typeof verifyVNextUniswapFeeInfrastructure>> | null = null;
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
  if (!globalServerGate || !globalClientGate) blockers.push("global wallet authorization gates are not both enabled");
  if (!walletSubmissionGate) blockers.push("wallet submission gate is off");
  if (!configured) blockers.push("exact policy and executor constructor values are not configured");
  if (!deployment) blockers.push("executor deployment and immutable runtime verification are incomplete");
  blockers.push("controlled small-value mainnet proof is not recorded by this code-only phase");
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
    infrastructure,
    deploymentVerifiedAtBlock: deployment?.verifiedAtBlock ?? null,
    gates: { policyGate, providerGate, globalServerGate, globalClientGate, walletSubmissionGate },
    releaseReady: blockers.length === 0,
    blockers
  }, null, 2));
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
