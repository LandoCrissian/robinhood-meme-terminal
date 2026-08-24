import { retiredTransactionPreparationResponse } from "../../../../../../lib/server/retired-transaction-preparation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return retiredTransactionPreparationResponse();
}
