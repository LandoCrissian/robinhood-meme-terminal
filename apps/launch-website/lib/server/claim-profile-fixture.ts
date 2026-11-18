import { type Address, type Hash, type Hex } from "viem";
import { isClaimExecutionReview, type ClaimWalletKind, type ClaimExecutionReview } from "../claim-profiles";
import { isEarningsClaimOperation } from "../earnings-claims";
import { isTransactionHash } from "../test-creation";
import { configuredCurveFixture, fixtureAddress, type CurveFixture } from "./curve-fixture";
import { fixtureEarningsContext } from "./earnings-contracts";
import { prepareClaimExecutionReview, revalidateClaimExecutionReview } from "./claim-profiles";
import { readFixtureBirth, readFixtureClaimIndexed } from "./earnings-claims";
import { verifyProductionClaimSettlement } from "./production-claims-settlement";

export const claimProfileFixture = "local-reviewed-claims-31337-v1";
const headers = { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
const reply = (body: object, status = 200) => Response.json(body, { status, headers });
const rejectedActors = ["0x7e8e7d3af28584a8b9eeddbe16cd3308bd1e76ca",
  "0xc447a378cfd8460febc2eef67501d7a5473b9001", "0xc3600f2df60929d2ab9ab294cff42eedcb984f51", "0x2bcc3fafce77ccc7fdbed46e0b5bb80ba3e76697"];
const keys = (value: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(value, k))
  && Object.keys(value).every(k => required.includes(k) || optional.includes(k));
export function configuredClaimProfileFixture(headers: Headers): CurveFixture | null {
  if (process.env.RMT_CLAIM_PROFILES_FIXTURE !== claimProfileFixture || headers.has("forwarded")) return null;
  return configuredCurveFixture(headers);
}
export async function readClaimProfileBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(), buffer = new Uint8Array(32_768);
  let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Claim request timed out")), 3000); });
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), timeout]); if (chunk.done) break;
      if (size + chunk.value.length > buffer.length) throw Error("Claim request exceeds its bound");
      buffer.set(chunk.value, size); size += chunk.value.length;
    }
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("Invalid claim request");
    return raw as Record<string, unknown>;
  } finally { if (timer) clearTimeout(timer); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
const freshSyntheticActor = (a: unknown): a is Address => fixtureAddress(a) && !rejectedActors.includes(a.toLowerCase());
let inflight = 0, window = -1, reads = 0;
function acquire() {
  const minute = Math.floor(Date.now() / 60000); if (window !== minute) { window = minute; reads = 0; }
  if (inflight >= 2 || reads >= 30) return null;
  reads++; inflight++; return () => { inflight--; };
}

/** Synthetic execution-test adapter only. There is no production activation
 * branch, remote RPC parameter, supplied context, signing key or broadcast API. */
export async function handleTestClaimProfile(request: Request) {
  const fixture = configuredClaimProfileFixture(request.headers);
  if (!fixture || request.method !== "POST") return reply({ status: "unavailable", executionEnabled: false }, 404);
  const url = new URL(request.url), origin = new URL(fixture.origin);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== origin.port
    || url.username || url.password || url.hash || url.search || request.headers.get("origin") !== fixture.origin) {
    return reply({ status: "invalid", executionEnabled: false }, 403);
  }
  const length = request.headers.get("content-length");
  if (length && (!/^[0-9]+$/.test(length) || Number(length) > 32768)) return reply({ status: "invalid" }, 413);
  const release = acquire(); if (!release) return reply({ status: "unavailable", reason: "Local claim reads are limited" }, 429);
  try {
    if (!request.body) return reply({ status: "invalid" }, 400);
    const body = await readClaimProfileBody(request.body);
    if (body.action === "prepare" && keys(body, ["action", "operation", "account", "beneficiary", "kind"], ["token", "safeAddress", "safeSignatures", "prior"])
      && isEarningsClaimOperation(body.operation) && freshSyntheticActor(body.account) && fixtureAddress(body.beneficiary)
      && typeof body.kind === "string" && ["eoa", "metamask-7702", "safe-1.4.1"].includes(body.kind)
      && (body.operation === "creation-fees" ? body.token === undefined : fixtureAddress(body.token))
      && (body.safeAddress === undefined || fixtureAddress(body.safeAddress))
      && (body.safeSignatures === undefined || typeof body.safeSignatures === "string" && /^0x[0-9a-f]{260}$/i.test(body.safeSignatures))
      && (body.prior === undefined || isClaimExecutionReview(body.prior))) {
      const birth = body.operation === "creation-fees" ? undefined : await readFixtureBirth(fixture, body.token as Address, body.beneficiary);
      const context = await fixtureEarningsContext(fixture);
      const review = await prepareClaimExecutionReview({ context, registration: birth?.registration, operation: body.operation,
        account: body.account, beneficiary: body.beneficiary, kind: body.kind as ClaimWalletKind,
        ...(body.safeAddress && { safeAddress: body.safeAddress as Address }), ...(body.safeSignatures && { safeSignatures: body.safeSignatures as Hex }),
        ...(body.prior && { prior: body.prior as ClaimExecutionReview }) });
      return reply(review);
    }
    if (typeof body.action === "string" && ["revalidate", "verify"].includes(body.action) && keys(body, ["action", "review"], ["transactionHash"])
      && isClaimExecutionReview(body.review) && body.review.chainId === 31337 && freshSyntheticActor(body.review.gasPayer)
      && (body.transactionHash === undefined || isTransactionHash(body.transactionHash))) {
      const review = body.review;
      const birth = review.inner.operation === "creation-fees" ? undefined : await readFixtureBirth(fixture, review.inner.token, review.inner.discoveryRecipient);
      const context = await fixtureEarningsContext(fixture);
      if (body.action === "revalidate") {
        if (body.transactionHash !== undefined) return reply({ status: "invalid" }, 400);
        const checked = await revalidateClaimExecutionReview(context, birth?.registration, review);
        return reply(isClaimExecutionReview(checked) && checked.reviewHash === review.reviewHash
          ? { status: "unchanged", reviewHash: review.reviewHash, executionEnabled: false } : checked);
      }
      const second = await fixtureEarningsContext(fixture, context.checkpoint);
      return reply(await verifyProductionClaimSettlement({ review, registration: birth?.registration,
        contexts: [{ id: "synthetic-a", context }, { id: "synthetic-b", context: second }],
        ...(body.transactionHash && { transactionHash: body.transactionHash as Hash }),
        indexed: async (activity, checkpoint) => {
          // Existing canonical rows identify the actual ledger caller (the Safe
          // for a Safe CALL). Settlement independently binds its external payer.
          const indexed = await readFixtureClaimIndexed(fixture, context, review.inner,
            activity.transactionHash, activity.blockHash, activity.logIndex, { nativeWei: activity.nativeWei, tokenWei: activity.tokenWei });
          return indexed ? { schemaVersion: 1, status: "canonical", activity, checkpoint } : null;
        } }));
    }
    return reply({ status: "invalid", executionEnabled: false }, 400);
  } catch { return reply({ status: "unavailable", reason: "Profile or canonical receipt evidence unavailable", executionEnabled: false }); }
  finally { release(); }
}
