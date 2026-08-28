import { createNftMintReceiptPostHandler } from "../../../../lib/server/nft-mint-receipt-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createNftMintReceiptPostHandler();
