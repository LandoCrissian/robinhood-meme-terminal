import { getAddress, isAddress, isHash } from "viem";
import { z } from "zod";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "../../../../../lib/server/rmt-trade-identity";
import {
  fetchEvmTransactionEvidence,
  refreshAcrossFundingSession,
  verifyAcrossSourceTransaction
} from "../../../../../lib/server/vnext-across-funding-status";
import {
  listCrossChainFundingSessions,
  readCrossChainFundingSession,
  saveCrossChainFundingSession
} from "../../../../../lib/server/vnext-cross-chain-funding-store";
import {
  crossChainFundingProofRecord,
  registerCrossChainFundingSourceSubmission
} from "../../../../../lib/vnext/cross-chain-funding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };
const walletSchema = z.string().refine((value) => isAddress(value, { strict: false }));
const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("source_submitted"), wallet: walletSchema, sessionId: z.string().uuid(), sourceTxHash: z.string().refine(isHash) }),
  z.object({ action: z.literal("refresh"), wallet: walletSchema, sessionId: z.string().uuid() })
]);

export async function GET(request: Request) {
  try {
    const parsed = walletSchema.safeParse(new URL(request.url).searchParams.get("wallet"));
    if (!parsed.success) return Response.json({ error: "Invalid funding wallet." }, { status: 400, headers: noStore });
    const wallet = getAddress(parsed.data);
    await requireAuthenticatedTradeWallet(request, wallet);
    const sessions = await listCrossChainFundingSessions(wallet);
    return Response.json({
      sessions,
      proofRecords: sessions.map(crossChainFundingProofRecord)
    }, { headers: noStore });
  } catch (cause) {
    const identity = tradeIdentityErrorResponse(cause);
    if (identity) return identity;
    return Response.json({ error: "RMT could not load cross-device funding recovery." }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid funding lifecycle request." }, { status: 400, headers: noStore });
    const wallet = getAddress(parsed.data.wallet);
    await requireAuthenticatedTradeWallet(request, wallet);
    let session = await readCrossChainFundingSession(wallet, parsed.data.sessionId);
    if (!session) return Response.json({ error: "Funding session not found." }, { status: 404, headers: noStore });
    if (parsed.data.action === "source_submitted") {
      const sourceTransaction = await fetchEvmTransactionEvidence(session.sourceChainId, parsed.data.sourceTxHash);
      if (!sourceTransaction) return Response.json({ error: "Source transaction is not indexed yet. Retry shortly." }, { status: 503, headers: noStore });
      verifyAcrossSourceTransaction({ session, expectedTransactionHash: parsed.data.sourceTxHash, transaction: sourceTransaction });
      session = registerCrossChainFundingSourceSubmission(session, parsed.data.sourceTxHash, Date.now());
    } else {
      session = await refreshAcrossFundingSession(session);
    }
    await saveCrossChainFundingSession(session);
    return Response.json({ session, proofRecord: crossChainFundingProofRecord(session) }, { headers: noStore });
  } catch (cause) {
    const identity = tradeIdentityErrorResponse(cause);
    if (identity) return identity;
    if (cause instanceof Error && /cannot be replaced|not awaiting a source transaction/.test(cause.message)) {
      return Response.json({ error: cause.message }, { status: 409, headers: noStore });
    }
    const message = cause instanceof Error && /not indexed|temporarily unavailable|could not read/.test(cause.message)
      ? cause.message
      : "RMT could not reconcile this funding session safely.";
    return Response.json({ error: message }, { status: 503, headers: noStore });
  }
}
