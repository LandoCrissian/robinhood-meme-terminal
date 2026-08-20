import { respondWithVNextChainPulse } from "../../../../lib/server/vnext-defillama-chain-pulse-response";

export async function GET() {
  return respondWithVNextChainPulse();
}
