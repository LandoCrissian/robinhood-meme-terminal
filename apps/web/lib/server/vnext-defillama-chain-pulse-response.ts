import {
  readVNextDefiLlamaChainPulse,
  type DefiLlamaChainPulse
} from "./vnext-defillama-chain-pulse";

const READY_PARTIAL_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
const NO_STORE_CACHE_CONTROL = "no-store";
const ERROR_MESSAGE = "Chain intelligence is temporarily unavailable.";

type ReadChainPulse = () => Promise<DefiLlamaChainPulse>;

export async function respondWithVNextChainPulse(
  readPulse: ReadChainPulse = readVNextDefiLlamaChainPulse
) {
  try {
    const pulse = await readPulse();
    const cacheControl = pulse.status === "ready" || pulse.status === "partial"
      ? READY_PARTIAL_CACHE_CONTROL
      : NO_STORE_CACHE_CONTROL;

    return Response.json(pulse, {
      headers: { "Cache-Control": cacheControl }
    });
  } catch {
    return Response.json(
      { error: ERROR_MESSAGE },
      {
        status: 503,
        headers: { "Cache-Control": NO_STORE_CACHE_CONTROL }
      }
    );
  }
}
