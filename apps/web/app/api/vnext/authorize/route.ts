import { randomUUID } from "node:crypto";
import { getAddress, type Hex } from "viem";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import { stockTokenExecutionPolicyErrorResponse } from "../../../../lib/server/robinhood-stock-token-registry";
import { readVNextVerifiedAssetIdentity } from "../../../../lib/server/vnext-asset-identity";
import { prepareRobinhoodVNextAuthorization } from "../../../../lib/server/vnext-execution-engine";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "../../../../lib/vnext/authorization-plan";
import {
  projectIdentityAdmissionErrorResponse,
  requireProjectIdentityDirectoryAdmitted
} from "../../../../lib/server/project-identity-admission";
import {
  directExecutionBinding,
  VNEXT_DIRECT_NO_RMT_FEE,
  VNEXT_LEGACY_V1_FEE,
  VNEXT_V2_ATOMIC_INPUT_FEE
} from "../../../../lib/vnext/execution-settlement";
import { vNextExecutionEligibilityErrorResponse } from "../../../../lib/server/vnext-execution-eligibility";
import {
  deriveVNextAuthorizationTiming,
  deriveVNextCommittedAuthorizationTiming,
  VNEXT_AUTHORIZATION_WINDOW_SECONDS,
  readVNextAuthorizationChainTimestamp
} from "../../../../lib/server/vnext-authorization-time";
import { vNextAuthorizationRequestSchema } from "../../../../lib/server/vnext-authorization-request";
import { selectVNextUniswapV3SettlementMode } from "../../../../lib/server/vnext-uniswap-quote";
import { selectVNextUniswapV2SettlementMode } from "../../../../lib/server/vnext-uniswap-v2-v2-execution";
import {
  configuredVNextUniswapV2FeeExecutorV2,
  requireVNextUniswapV2V2ReleaseRecipient
} from "../../../../lib/server/vnext-uniswap-v2-fee-executor-v2";
import {
  configuredVNextUniswapFeeExecutorV2,
  requireVNextUniswapV3V2ReleaseRecipient
} from "../../../../lib/server/vnext-uniswap-fee-executor-v2";
import {
  assertVNextV2AuthorizationRequestContinuity,
  assertVNextV2VerificationContinuity,
  verifyVNextV2VerificationCommitment,
  VNextV2VerificationCommitmentConfigurationError,
  VNextV2VerificationCommitmentError
} from "../../../../lib/server/vnext-v2-verification-commitment";
import {
  requireVNextPublicExecutionProvider,
  requireVNextPublicExecutionSettlement,
  vNextPublicExecutionProviderScopeErrorResponse
} from "../../../../lib/server/vnext-public-execution-provider-scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

function verifyAgain(message: string) {
  return Response.json({ error: "VERIFY_AGAIN", message }, { status: 409, headers: noStore });
}

export async function POST(request: Request) {
  if (process.env.RMT_VNEXT_AUTHORIZATION_ENABLED !== "true") {
    return Response.json({ error: "VNext wallet authorization is not enabled." }, { status: 503, headers: noStore });
  }
  let v2ContinuityRequired = false;
  try {
    const parsed = vNextAuthorizationRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid VNext authorization request." }, { status: 400, headers: noStore });
    const hasCompleteV4Binding = Boolean(parsed.data.canonicalMarket && parsed.data.v4QuoteEvidence);
    if ((parsed.data.provider === "uniswap-v4") !== hasCompleteV4Binding) {
      return Response.json({ error: "Invalid VNext V4 authorization binding." }, { status: 400, headers: noStore });
    }
    requireVNextPublicExecutionProvider(parsed.data.provider);
    if (BigInt(parsed.data.indicativeProtectedOutputFloorAtomic) > BigInt(parsed.data.expectedProtectedOutputAtomic)) {
      return Response.json({ error: "Invalid VNext quote-continuity floor." }, { status: 400, headers: noStore });
    }
    const recipient = getAddress(parsed.data.recipient);
    const inputAsset = getAddress(parsed.data.inputAsset);
    const outputAsset = getAddress(parsed.data.outputAsset);
    const tradeAuthorization = await requireAuthenticatedTradeWallet(request, recipient);
    const [inputIdentity, outputIdentity] = await Promise.all([
      readVNextVerifiedAssetIdentity(inputAsset),
      readVNextVerifiedAssetIdentity(outputAsset)
    ]);
    if (!inputIdentity || !outputIdentity) {
      return Response.json({ error: "Both assets require verified Robinhood Chain identity before wallet review." }, { status: 422, headers: noStore });
    }
    await requireProjectIdentityDirectoryAdmitted([
      { address: inputAsset },
      { address: outputAsset }
    ]);

    const settlementMode = parsed.data.provider === "uniswap-v3"
      ? selectVNextUniswapV3SettlementMode({ inputAsset, outputAsset, recipient })
      : parsed.data.provider === "uniswap-v2"
        ? selectVNextUniswapV2SettlementMode({ recipient })
        : VNEXT_DIRECT_NO_RMT_FEE;
    requireVNextPublicExecutionSettlement(parsed.data.provider, settlementMode);
    if (parsed.data.settlementMode !== settlementMode) {
      return verifyAgain("The exact verified settlement authority changed. Verify again.");
    }
    v2ContinuityRequired = settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE;
    if (v2ContinuityRequired) {
      if (parsed.data.provider === "uniswap-v2") requireVNextUniswapV2V2ReleaseRecipient(recipient);
      else requireVNextUniswapV3V2ReleaseRecipient(recipient);
    }
    if (settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE && (
      !parsed.data.executionId
      || parsed.data.executionId === `0x${"0".repeat(64)}`
      || !parsed.data.v2VerificationCommitment
    )) {
      return verifyAgain("The exact verified V2 authority is missing. Verify again.");
    }
    if (settlementMode === VNEXT_LEGACY_V1_FEE && (
      !parsed.data.executionId
      || parsed.data.executionId === `0x${"0".repeat(64)}`
      || parsed.data.v2VerificationCommitment !== undefined
    )) {
      return verifyAgain("The exact verified V1 authority is missing or contradictory. Verify again.");
    }
    if (settlementMode === VNEXT_DIRECT_NO_RMT_FEE && (
      parsed.data.executionId !== undefined || parsed.data.v2VerificationCommitment !== undefined
    )) {
      return verifyAgain("The direct execution request contains contradictory fee authority. Verify again.");
    }

    const authorizationWallClockMs = Date.now();
    const v2Claims = settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE
      ? verifyVNextV2VerificationCommitment({
          token: parsed.data.v2VerificationCommitment!,
          identityId: tradeAuthorization.identityId,
          wallet: recipient,
          quoteRequestId: parsed.data.quoteRequestId,
          verificationId: parsed.data.verificationId,
          nowMs: authorizationWallClockMs
        })
      : null;
    if (v2Claims) assertVNextV2AuthorizationRequestContinuity({ claims: v2Claims, request: parsed.data });
    const chainTimestampSeconds = await readVNextAuthorizationChainTimestamp();
    const finalDeadlineSeconds = v2Claims
      ? BigInt(v2Claims.deadline)
      : chainTimestampSeconds + VNEXT_AUTHORIZATION_WINDOW_SECONDS;
    const prepared = await prepareRobinhoodVNextAuthorization(parsed.data.provider, {
      chainId: 4_663,
      inputAsset,
      outputAsset,
      amountIn: BigInt(parsed.data.inputAmountAtomic),
      inputAmountAtomic: parsed.data.inputAmountAtomic,
      recipient,
      deadlineSeconds: finalDeadlineSeconds,
      indicativeProtectedOutputFloorAtomic: BigInt(parsed.data.indicativeProtectedOutputFloorAtomic),
      protectedOutputFloorAtomic: BigInt(parsed.data.expectedProtectedOutputAtomic),
      nowMs: authorizationWallClockMs,
      settlementMode,
      ...(parsed.data.canonicalMarket ? { canonicalMarket: parsed.data.canonicalMarket as { sourceId: "uniswap-v4"; poolId: `0x${string}` } } : {}),
      ...(parsed.data.v4QuoteEvidence ? { v4QuoteEvidence: parsed.data.v4QuoteEvidence as typeof parsed.data.v4QuoteEvidence & { poolId: `0x${string}`; observedBlockHash: `0x${string}` } } : {}),
      ...(parsed.data.executionId ? { executionId: parsed.data.executionId as Hex } : {}),
      ...(v2Claims?.provider === "uniswap-v2" && v2Claims.infrastructureVerifiedAtBlock && v2Claims.infrastructureVerifiedAtBlockHash ? {
        infrastructureVerifiedAtBlock: v2Claims.infrastructureVerifiedAtBlock,
        infrastructureVerifiedAtBlockHash: v2Claims.infrastructureVerifiedAtBlockHash as Hex
      } : {})
    });
    if (prepared.evidence.provider !== "uniswap-v2" && prepared.evidence.provider !== "uniswap-v3" && prepared.evidence.provider !== "uniswap-v4" && prepared.evidence.provider !== "up-v2" && prepared.evidence.provider !== "up-cl") {
      return Response.json({ error: "This provider does not have a supported wallet-plan codec yet." }, { status: 422, headers: noStore });
    }
    const evidenceChanged = prepared.evidence.status !== parsed.data.expectedStatus
      || BigInt(prepared.evidence.protectedOutputAtomic) < BigInt(parsed.data.expectedProtectedOutputAtomic)
      || (settlementMode === VNEXT_LEGACY_V1_FEE && prepared.evidence.feeExecution?.executionId !== parsed.data.executionId)
      || (settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE && prepared.evidence.feeV2Settlement?.executionId !== parsed.data.executionId);
    if (evidenceChanged) {
      return v2Claims
        ? verifyAgain("The exact verified V2 route evidence changed. Verify again.")
        : Response.json({ error: "Route evidence changed. Verify the route again." }, { status: 409, headers: noStore });
    }

    if (v2Claims) {
      const config = parsed.data.provider === "uniswap-v2"
        ? configuredVNextUniswapV2FeeExecutorV2()
        : configuredVNextUniswapFeeExecutorV2();
      if (!config || getAddress(config.executor) !== getAddress(v2Claims.executor)) {
        throw new VNextV2VerificationCommitmentError("The V2 executor authority is unavailable or changed.");
      }
      assertVNextV2VerificationContinuity({
        claims: v2Claims,
        evidence: {
          verificationId: parsed.data.verificationId,
          sourceQuoteRequestId: parsed.data.quoteRequestId,
          ...prepared.evidence
        } as never,
        executorRuntimeHash: config.executorRuntimeHash
      });
    }
    const timing = v2Claims
      ? deriveVNextCommittedAuthorizationTiming(chainTimestampSeconds, authorizationWallClockMs, BigInt(v2Claims.deadline))
      : deriveVNextAuthorizationTiming(chainTimestampSeconds, authorizationWallClockMs);
    if (BigInt(prepared.evidence.deadline) !== timing.deadlineSeconds) {
      return v2Claims
        ? verifyAgain("The final server deadline changed during V2 authorization. Verify again.")
        : Response.json({ error: "The final server deadline changed during authorization." }, { status: 409, headers: noStore });
    }
    const preparedAtMs = timing.preparedAtMs;
    const expiresAtMs = timing.expiresAtMs;
    const unsignedPlan = {
      planId: randomUUID(),
      sourceQuoteRequestId: parsed.data.quoteRequestId,
      sourceVerificationId: parsed.data.verificationId,
      provider: prepared.evidence.provider,
      kind: prepared.transaction.kind,
      chainId: 4_663 as const,
      target: prepared.transaction.target,
      data: prepared.transaction.data,
      value: prepared.transaction.value,
      gasLimit: prepared.transaction.gasLimit,
      inputAsset: prepared.evidence.inputAsset,
      outputAsset: prepared.evidence.outputAsset,
      inputAmountAtomic: prepared.evidence.inputAmountAtomic,
      protectedOutputAtomic: prepared.evidence.protectedOutputAtomic,
      recipient: prepared.evidence.recipient,
      router: prepared.evidence.router,
      settlementMode: prepared.evidence.settlementMode,
      ...(prepared.evidence.directNoRmtFee ? { directNoRmtFee: prepared.evidence.directNoRmtFee } : {}),
      ...(prepared.evidence.settlementMode === VNEXT_DIRECT_NO_RMT_FEE ? { directAuthorization: directExecutionBinding({
        provider: prepared.evidence.provider,
        kind: prepared.transaction.kind,
        chainId: 4_663,
        inputAsset: prepared.evidence.inputAsset,
        outputAsset: prepared.evidence.outputAsset,
        inputAmountAtomic: prepared.evidence.inputAmountAtomic,
        protectedOutputAtomic: prepared.evidence.protectedOutputAtomic,
        recipient: prepared.evidence.recipient,
        providerTarget: prepared.evidence.router,
        executionTarget: prepared.transaction.target,
        approvalSpender: prepared.evidence.approvalSpender,
        approvalAmountAtomic: prepared.evidence.inputAmountAtomic,
        data: prepared.transaction.data,
        valueAtomic: prepared.transaction.value,
        deadline: prepared.evidence.deadline
      }) } : {}),
      ...(prepared.evidence.netEconomics ? { netEconomics: prepared.evidence.netEconomics } : {}),
      ...(prepared.evidence.feeExecution !== undefined ? { feeExecution: prepared.evidence.feeExecution } : {}),
      ...(prepared.evidence.feeV2Economics ? { feeV2Economics: prepared.evidence.feeV2Economics } : {}),
      ...(prepared.feeV2Authorization ? { feeV2Authorization: prepared.feeV2Authorization } : {}),
      ...(prepared.evidence.v4Execution ? { v4Execution: prepared.evidence.v4Execution } : {}),
      deadline: prepared.evidence.deadline,
      preparedAtMs,
      expiresAtMs,
      userAuthorizationRequired: true as const,
      serverSubmissionEnabled: false as const
    };
    const plan: VNextAuthorizationPlan = {
      ...unsignedPlan,
      payloadHash: authorizationPayloadHash(unsignedPlan) as Hex
    };
    return Response.json({
      evidence: {
        verificationId: parsed.data.verificationId,
        sourceQuoteRequestId: parsed.data.quoteRequestId,
        ...prepared.evidence,
        ...(v2Claims ? { v2VerificationCommitment: parsed.data.v2VerificationCommitment } : {})
      },
      plan
    }, { headers: noStore });
  } catch (cause) {
    const publicProviderResponse = vNextPublicExecutionProviderScopeErrorResponse(cause);
    if (publicProviderResponse) return publicProviderResponse;
    const identityResponse = tradeIdentityErrorResponse(cause);
    if (identityResponse) return identityResponse;
    const eligibilityResponse = vNextExecutionEligibilityErrorResponse(cause);
    if (eligibilityResponse) return eligibilityResponse;
    const projectIdentityResponse = projectIdentityAdmissionErrorResponse(cause);
    if (projectIdentityResponse) return projectIdentityResponse;
    const stockTokenResponse = stockTokenExecutionPolicyErrorResponse(cause);
    if (stockTokenResponse) return stockTokenResponse;
    if (cause instanceof VNextV2VerificationCommitmentConfigurationError) {
      return Response.json({ error: cause.message }, { status: 503, headers: noStore });
    }
    if (cause instanceof VNextV2VerificationCommitmentError || v2ContinuityRequired) {
      return verifyAgain("The exact verified V2 transaction can no longer be authorized. Verify again.");
    }
    const message = cause instanceof Error && /deadline is stale|exact next action is not ready|wallet authorization is not available|V2 wallet authorization is disabled|V2 authorization is enabled without a complete executor policy|RMT_EXECUTION_V2 policy is not effective until block|rejected Uniswap V4 execution/.test(cause.message)
      ? cause.message
      : "Unable to prepare an exact wallet-review payload.";
    return Response.json({ error: message }, { status: 422, headers: noStore });
  }
}
