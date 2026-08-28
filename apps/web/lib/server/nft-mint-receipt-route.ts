import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { verifyRmtNftMintReceipt, type RmtNftMintReceiptContext } from "./nft-mint-receipt";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "./rmt-trade-identity";

const uintString = z.string().regex(/^(?:0|[1-9][0-9]*)$/);
const address = z.string().refine((value) => isAddress(value, { strict: false }));
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const requestSchema = z.object({
  txHash: hash,
  candidateId: z.string().regex(/^opensea:[a-zA-Z0-9._-]{1,160}$/),
  providerCollectionSlug: z.string().min(1).max(160),
  collection: address,
  wallet: address,
  quantity: uintString.refine((value) => BigInt(value) >= 1n && BigInt(value) <= 10n),
  method: z.enum(["MINT_PUBLIC", "MINT_ALLOWED_TOKEN_HOLDER"]),
  target: address,
  value: uintString,
  calldataHash: hash,
  preflightDigest: hash,
  stage: z.object({
    startTime: z.string().datetime(), endTime: z.string().datetime(), maxPerWallet: uintString,
    maxSupplyForStage: uintString.nullable(), dropStageIndex: uintString.nullable(), feeBps: uintString,
    restrictFeeRecipients: z.boolean(),
  }).strict(),
  simulationBlockNumber: uintString,
  planCheckedAt: z.string().datetime(),
}).strict();

type WalletBinder = (request: Request, wallet: Address) => Promise<unknown>;
type ReceiptVerifier = typeof verifyRmtNftMintReceipt;

export function createNftMintReceiptPostHandler(dependencies: { bindWallet?: WalletBinder; verifyReceipt?: ReceiptVerifier } = {}) {
  const bindWallet = dependencies.bindWallet ?? requireAuthenticatedTradeWallet;
  const verifyReceipt = dependencies.verifyReceipt ?? verifyRmtNftMintReceipt;
  return async function POST(request: Request) {
    try {
      const parsed = requestSchema.safeParse(await request.json());
      if (!parsed.success) return Response.json({ error: "Invalid NFT mint receipt request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      const context = {
        ...parsed.data,
        txHash: parsed.data.txHash as Hex,
        calldataHash: parsed.data.calldataHash as Hex,
        preflightDigest: parsed.data.preflightDigest as Hex,
        collection: getAddress(parsed.data.collection),
        wallet: getAddress(parsed.data.wallet),
        target: getAddress(parsed.data.target),
      } satisfies RmtNftMintReceiptContext;
      await bindWallet(request, context.wallet);
      return Response.json(await verifyReceipt({ context }), { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      const identityResponse = tradeIdentityErrorResponse(cause);
      if (identityResponse) return identityResponse;
      return Response.json({ error: "NFT mint receipt evidence could not be established." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
  };
}
