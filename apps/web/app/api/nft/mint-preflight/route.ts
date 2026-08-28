import { createNftMintPreflightPostHandler } from "../../../../lib/server/nft-mint-preflight-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createNftMintPreflightPostHandler();
