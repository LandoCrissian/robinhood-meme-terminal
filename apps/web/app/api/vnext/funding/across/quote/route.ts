import { randomUUID } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../../../lib/server/rmt-trade-identity";
import {
  acrossFundingOperationalState,
  acrossFundingSourceChain,
  prepareAcrossFundingQuote,
  readAcrossFundingWalletReadiness,
  trustedAcrossFundingPair
} from "../../../../../../lib/server/vnext-across-funding";
import { readAcrossPostQuoteGasReadiness } from "../../../../../../lib/server/vnext-across-gas-readiness";
import { saveCrossChainFundingSession } from "../../../../../../lib/server/vnext-cross-chain-funding-store";
import {
  createCrossChainFundingSession,
  crossChainFundingDisclosure
} from "../../../../../../lib/vnext/cross-chain-funding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };
const requestSchema = z.object({
  sourceChainId: z.union([z.literal(1), z.literal(42_161), z.literal(8_453)]),
  sourceToken: z.string().refine((value) => isAddress(value, { strict: false })),
  inputAmountAtomic: z.string().regex(/^[1-9][0-9]{0,77}$/),
  recipient: z.string().refine((value) => isAddress(value, { strict: false }))
});

export async function POST(request: Request) {
  const operational = acrossFundingOperationalState();
  if (!operational.authorizationEnabled) {
    return Response.json({ error: "Across funding wallet authorization is release-locked." }, { status: 503, headers: noStore });
  }
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid cross-chain funding request." }, { status: 400, headers: noStore });
    const sourceChainId = acrossFundingSourceChain(parsed.data.sourceChainId);
    const sourceToken = getAddress(parsed.data.sourceToken);
    const recipient = getAddress(parsed.data.recipient);
    if (!sourceChainId || !trustedAcrossFundingPair(sourceChainId, sourceToken)) {
      return Response.json({ error: "This chain-qualified funding pair is not trusted." }, { status: 422, headers: noStore });
    }
    await requireAuthenticatedTradeWallet(request, recipient);
    const fundingReadiness = await readAcrossFundingWalletReadiness({
      sourceChainId,
      sourceToken,
      wallet: recipient,
      requestedInputAtomic: parsed.data.inputAmountAtomic
    });
    if (!fundingReadiness.fundedPreflightReady) {
      return Response.json({
        error: "This wallet is not funded for the selected source-chain route.",
        fundingReadiness: {
          sourceChainId,
          sourceToken,
          sourceBalanceAtomic: fundingReadiness.sourceBalanceAtomic,
          nativeGasBalanceAtomic: fundingReadiness.nativeGasBalanceAtomic,
          requestedInputAtomic: fundingReadiness.requestedInputAtomic,
          sufficientSourceBalance: fundingReadiness.sufficientSourceBalance,
          hasNativeGas: fundingReadiness.hasNativeGas,
          transactionAttempted: false
        }
      }, { status: 422, headers: noStore });
    }
    const prepared = await prepareAcrossFundingQuote({
      sourceChainId,
      sourceToken,
      inputAmountAtomic: parsed.data.inputAmountAtomic,
      depositor: recipient,
      recipient,
      requestedAtMs: Date.now()
    });
    const gasReadiness = await readAcrossPostQuoteGasReadiness({ prepared, wallet: recipient });
    if (gasReadiness.status !== "sufficient") {
      return Response.json({
        error: gasReadiness.status === "insufficient"
          ? "This wallet does not have enough native gas for the verified Across transactions."
          : "RMT could not verify native gas readiness for the exact Across transactions.",
        gasReadiness,
        transactionAttempted: false
      }, { status: 422, headers: noStore });
    }
    const session = createCrossChainFundingSession({ sessionId: randomUUID(), evidence: prepared.evidence, nowMs: Date.now() });
    await saveCrossChainFundingSession(session);
    return Response.json({
      session,
      disclosure: crossChainFundingDisclosure(session),
      approvalTransaction: prepared.approvalTransaction,
      depositTransaction: prepared.depositTransaction,
      gasReadiness,
      userAuthorizationRequired: true,
      serverSubmissionEnabled: false
    }, { headers: noStore });
  } catch (cause) {
    const identity = tradeIdentityErrorResponse(cause);
    if (identity) return identity;
    const message = cause instanceof Error && /persistence is not configured|release-locked/.test(cause.message)
      ? cause.message
      : "RMT could not prepare a verified Across funding route.";
    return Response.json({ error: message }, { status: 503, headers: noStore });
  }
}
