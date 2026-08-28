import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { readRmtNftMintRadar, type RmtMintRadarResponse } from "./nft-mint-radar";
import {
  RMT_NFT_MINT_PREFLIGHT_MAX_AGE_MS,
  runRmtNftMintPreflight,
  type RmtNftMintPreflightReport,
  type RmtNftMintPreflightStatus,
} from "./nft-mint-preflight";
import { requireAuthenticatedTradeWallet, tradeIdentityErrorResponse } from "./rmt-trade-identity";

const requestSchema = z.object({
  candidateId: z.string().regex(/^opensea:[a-zA-Z0-9._-]{1,160}$/),
  wallet: z.string().refine((value) => isAddress(value, { strict: false })),
  quantity: z.number().int().min(1).max(10),
}).strict();

type WalletBinder = (request: Request, wallet: Address) => Promise<unknown>;
type RadarReader = () => Promise<RmtMintRadarResponse>;
type PreflightRunner = typeof runRmtNftMintPreflight;

function unavailableReport(input: {
  candidateId: string;
  wallet: Address;
  quantity: number;
  status: RmtNftMintPreflightStatus;
  message: string;
}): RmtNftMintPreflightReport {
  const checkedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    chainId: 4_663,
    status: input.status,
    message: input.message,
    candidateId: input.candidateId,
    provider: "OPENSEA_DROPS_V2",
    providerCollectionSlug: input.candidateId.slice("opensea:".length),
    collection: null,
    wallet: input.wallet,
    recipient: null,
    quantity: String(input.quantity),
    method: null,
    target: null,
    calldataHash: null,
    mintPriceWei: null,
    totalValueWei: null,
    stage: null,
    supply: null,
    ccff00Access: null,
    simulation: { status: "NOT_RUN", blockNumber: null, gasEstimate: null, reason: null },
    digest: null,
    checkedAt,
    expiresAt: new Date(Date.parse(checkedAt) + RMT_NFT_MINT_PREFLIGHT_MAX_AGE_MS).toISOString(),
    rmtAdmission: "NOT_EVALUATED",
    projectTokenRelationship: null,
    transactionSubmitted: false,
    walletSignatureRequested: false,
  };
}

export function createNftMintPreflightPostHandler(dependencies: {
  bindWallet?: WalletBinder;
  readRadar?: RadarReader;
  runPreflight?: PreflightRunner;
} = {}) {
  const bindWallet = dependencies.bindWallet ?? requireAuthenticatedTradeWallet;
  const readRadar = dependencies.readRadar ?? readRmtNftMintRadar;
  const runPreflight = dependencies.runPreflight ?? runRmtNftMintPreflight;
  return async function POST(request: Request) {
    try {
      const parsed = requestSchema.safeParse(await request.json());
      if (!parsed.success) {
        return Response.json({ error: "Invalid NFT mint readiness request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      const wallet = getAddress(parsed.data.wallet);
      await bindWallet(request, wallet);
      const radar = await readRadar();
      if (radar.status !== "READY") {
        return Response.json(unavailableReport({
          candidateId: parsed.data.candidateId,
          wallet,
          quantity: parsed.data.quantity,
          status: "PROVIDER_UNAVAILABLE",
          message: "Fresh Mint Radar evidence is unavailable; RMT stopped before requesting a mint proposal.",
        }), { headers: { "Cache-Control": "no-store" } });
      }
      const candidate = radar.live.find((item) => item.candidateId === parsed.data.candidateId);
      if (!candidate) {
        return Response.json(unavailableReport({
          candidateId: parsed.data.candidateId,
          wallet,
          quantity: parsed.data.quantity,
          status: "NOT_PREFLIGHT_ELIGIBLE",
          message: "This candidate is not in the current bounded LIVE NOW Radar feed.",
        }), { headers: { "Cache-Control": "no-store" } });
      }
      const report = await runPreflight({ candidate, wallet, quantity: BigInt(parsed.data.quantity) });
      return Response.json(report, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      const identityResponse = tradeIdentityErrorResponse(cause);
      if (identityResponse) return identityResponse;
      return Response.json({ error: "NFT mint readiness could not be established." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
  };
}
