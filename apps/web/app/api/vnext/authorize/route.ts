import { randomUUID } from "node:crypto";
import { getAddress, isAddress, type Hex } from "viem";
import { z } from "zod";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../lib/server/rmt-trade-identity";
import { readRobinhoodTokenIdentity } from "../../../../lib/server/universal-market-resolver";
import { prepareRobinhoodVNextAuthorization } from "../../../../lib/server/vnext-execution-engine";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "../../../../lib/vnext/authorization-plan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const requestSchema = z.object({
  chainId: z.literal(4_663),
  quoteRequestId: z.string().uuid(),
  verificationId: z.string().uuid(),
  provider: z.enum(["sushi", "uniswap-v3"]),
  inputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  outputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  inputAmountAtomic: z.string().regex(/^[1-9][0-9]*$/),
  recipient: z.string().refine((value) => isAddress(value, { strict: false })),
  deadline: z.string().regex(/^[1-9][0-9]*$/),
  expectedStatus: z.enum(["approval_required", "verified"]),
  expectedProtectedOutputAtomic: z.string().regex(/^[1-9][0-9]*$/),
  expectedGasLimitUnits: z.string().regex(/^[1-9][0-9]*$/),
  expectedSwapCalldataHash: hash,
  expectedNextActionCalldataHash: hash
});

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (process.env.RMT_VNEXT_AUTHORIZATION_ENABLED !== "true") {
    return Response.json({ error: "VNext wallet authorization is not enabled." }, { status: 503, headers: noStore });
  }
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid VNext authorization request." }, { status: 400, headers: noStore });
    const recipient = getAddress(parsed.data.recipient);
    const inputAsset = getAddress(parsed.data.inputAsset);
    const outputAsset = getAddress(parsed.data.outputAsset);
    await requireAuthenticatedTradeWallet(request, recipient);
    const [inputIdentity, outputIdentity] = await Promise.all([
      readRobinhoodTokenIdentity(inputAsset),
      readRobinhoodTokenIdentity(outputAsset)
    ]);
    if (!inputIdentity || !outputIdentity) {
      return Response.json({ error: "Both assets require verified Robinhood Chain identity before wallet review." }, { status: 422, headers: noStore });
    }

    const preparedAtMs = Date.now();
    const prepared = await prepareRobinhoodVNextAuthorization(parsed.data.provider, {
      chainId: 4_663,
      inputAsset,
      outputAsset,
      amountIn: BigInt(parsed.data.inputAmountAtomic),
      inputAmountAtomic: parsed.data.inputAmountAtomic,
      recipient,
      deadlineSeconds: BigInt(parsed.data.deadline),
      nowMs: preparedAtMs
    });
    if (prepared.evidence.provider !== "uniswap-v3") {
      return Response.json({ error: "This provider does not have a supported wallet-plan codec yet." }, { status: 422, headers: noStore });
    }
    const evidenceChanged = prepared.evidence.status !== parsed.data.expectedStatus
      || prepared.evidence.protectedOutputAtomic !== parsed.data.expectedProtectedOutputAtomic
      || prepared.evidence.gasLimitUnits !== parsed.data.expectedGasLimitUnits
      || prepared.evidence.calldataHash.toLowerCase() !== parsed.data.expectedSwapCalldataHash.toLowerCase()
      || prepared.evidence.nextActionCalldataHash?.toLowerCase() !== parsed.data.expectedNextActionCalldataHash.toLowerCase();
    if (evidenceChanged) {
      return Response.json({ error: "Route evidence changed. Verify the route again." }, { status: 409, headers: noStore });
    }

    const expiresAtMs = Math.min(preparedAtMs + 60_000, Number(BigInt(prepared.evidence.deadline) * 1_000n));
    const unsignedPlan = {
      planId: randomUUID(),
      sourceQuoteRequestId: parsed.data.quoteRequestId,
      sourceVerificationId: parsed.data.verificationId,
      provider: prepared.evidence.provider,
      kind: prepared.transaction.kind,
      chainId: 4_663 as const,
      target: prepared.transaction.target,
      data: prepared.transaction.data,
      value: "0" as const,
      gasLimit: prepared.transaction.gasLimit,
      inputAsset: prepared.evidence.inputAsset,
      outputAsset: prepared.evidence.outputAsset,
      inputAmountAtomic: prepared.evidence.inputAmountAtomic,
      protectedOutputAtomic: prepared.evidence.protectedOutputAtomic,
      recipient: prepared.evidence.recipient,
      router: prepared.evidence.router,
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
    return Response.json(plan, { headers: noStore });
  } catch (cause) {
    const identityResponse = tradeIdentityErrorResponse(cause);
    if (identityResponse) return identityResponse;
    const message = cause instanceof Error && /deadline is stale|exact next action is not ready|wallet authorization is not available/.test(cause.message)
      ? cause.message
      : "Unable to prepare an exact wallet-review payload.";
    return Response.json({ error: message }, { status: 422, headers: noStore });
  }
}
