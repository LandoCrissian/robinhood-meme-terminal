import { NextResponse } from "next/server";
import { getAddress, isAddress, isHash, TransactionReceiptNotFoundError, zeroAddress } from "viem";
import { readLaunchpadRuntime, verifiedLaunchpadRpc } from "../../../../lib/server/new-launchpad-config";
import { InvalidLaunchReceipt, verifyLaunchReceipt } from "../../../../lib/server/new-launchpad-receipt";
import { LaunchpadStore } from "../../../../lib/server/new-launchpad-store";
import { isLaunchShowcase } from "../../../../lib/server/launchpad-site-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = params.get("token");
  const creator = params.get("creator");
  if ((token !== null && !isAddress(token)) || (creator !== null && !isAddress(creator))) {
    return NextResponse.json({ status: "delayed", launches: [], reason: "Invalid token or creator address." }, { status: 400, headers });
  }

  let store: LaunchpadStore | undefined;
  try {
    const config = readLaunchpadRuntime();
    if (!config) return NextResponse.json({ status: "disabled", launches: [] }, { headers });
    store = new LaunchpadStore(config.databasePath, config.scope);
    const retryAfterSeconds = store.consumePublicQuota(token ? "get_launch" : "list_launches", 60);
    if (retryAfterSeconds) {
      return NextResponse.json({ status: "rate_limited", launches: [], retryAfterSeconds },
        { status: 429, headers: { ...headers, "Retry-After": retryAfterSeconds.toString() } });
    }
    const launches = store.read({ token: token ? getAddress(token) : undefined, creator: creator ? getAddress(creator) : undefined });
    return NextResponse.json({ status: store.status(), launches }, { headers });
  } catch {
    return NextResponse.json({ status: "delayed", launches: [] }, { status: 503, headers });
  } finally {
    store?.close();
  }
}

async function readRequest(request: Request): Promise<Record<string, unknown> | undefined> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !request.body) return;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let payload = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 512) {
        await reader.cancel();
        return;
      }
      payload += decoder.decode(value, { stream: true });
    }
    const parsed: unknown = JSON.parse(payload + decoder.decode());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    await reader.cancel().catch(() => undefined);
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  if (isLaunchShowcase()) return NextResponse.json({ status: "disabled", reason: "New launches are disabled on this deployment." }, { status: 403, headers });
  const data = await readRequest(request);
  const { transactionHash, creator, intentId } = data ?? {};
  if (typeof transactionHash !== "string" || !isHash(transactionHash) || typeof creator !== "string" || !isAddress(creator)
    || getAddress(creator) === zeroAddress || typeof intentId !== "string" || !isHash(intentId)) {
    return NextResponse.json({ status: "invalid", reason: "Provide a transaction hash, creator and launch intent ID." }, { status: 400, headers });
  }

  let store: LaunchpadStore | undefined;
  try {
    const config = readLaunchpadRuntime();
    if (!config) return NextResponse.json({ status: "disabled", reason: "New launches are disabled on this deployment." }, { status: 403, headers });
    store = new LaunchpadStore(config.databasePath, config.scope);
    const retryAfterSeconds = store.consumePublicQuota("verify_receipt", 30);
    if (retryAfterSeconds) {
      return NextResponse.json({ status: "rate_limited", reason: "Launch verification read limit reached.", retryAfterSeconds },
        { status: 429, headers: { ...headers, "Retry-After": retryAfterSeconds.toString() } });
    }
    const rpc = await verifiedLaunchpadRpc(config);
    const launch = await verifyLaunchReceipt(rpc, config.deployment, transactionHash, { creator: getAddress(creator), intentId });
    if (BigInt(launch.blockNumber) < config.startBlock) throw new InvalidLaunchReceipt("The transaction predates the verified launch factory.");
    const published = store.publish(launch);
    return NextResponse.json({ status: "confirmed", launch: published, indexing: published.indexing }, { headers });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) {
      return NextResponse.json({ status: "pending", reason: "The transaction receipt is pending." }, { status: 202, headers });
    }
    if (error instanceof InvalidLaunchReceipt) {
      return NextResponse.json({ status: "invalid", reason: error.message }, { status: 422, headers });
    }
    return NextResponse.json({ status: "delayed", reason: "Launch verification is temporarily unavailable. Retry using the same transaction." }, { status: 503, headers });
  } finally {
    store?.close();
  }
}
