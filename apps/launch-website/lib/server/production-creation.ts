import { assetCID } from "../token-artwork";
import { configuredArtworkStore, readArtwork } from "./token-artwork";
import { decodeFunctionData, getAddress, type Hex } from "viem";
import { isProductionCreationRequest, productionCreationAbi, productionCreationFactory, type ProductionCreationRequest } from "../production-creation";
import { isTransactionHash } from "../test-creation";
import { configuredCurveProductionRelease, curveProductionDeployment, curveProductionPins, normalizeProductionCreationFields,
  prepareCurveProductionCreation, verifyCurveProduction } from "./curve-production";
import { readDraftBody } from "./launch-draft";
import { isRmtCreation, rmtCreationOwner } from "../owner-creation";
import { isAuthenticatedCreationOwner, issueOwnerReviewChallenge } from "./owner-creation-auth";
import { configuredProductionDiscovery, readProductionDiscovery } from "./production-discovery";
import { verifyCanonicalCurveCreation } from "./test-creation";

const reply = (body: object, status = 200) => Response.json(body, { status, headers: {
  "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
} });
const keys = (value: unknown, allowed: string[]): value is Record<string, unknown> => !!value && typeof value === "object"
  && !Array.isArray(value) && Object.keys(value).length === allowed.length && allowed.every((key) => Object.hasOwn(value, key));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const productionCreationEnabled = (env: Record<string, string | undefined> = process.env) =>
  env.RMT_CURVE_PRODUCTION_EXECUTION === "owner-creation-approved";

function preparedRequest(input: unknown): ProductionCreationRequest | null {
  if (!isProductionCreationRequest(input)) return null;
  const decoded = decodeFunctionData({ abi: productionCreationAbi, data: input.data });
  const [name, symbol, projectURI, treasury, treasuryShareBps] = decoded.args;
  if (!normalizeProductionCreationFields({ name, symbol, projectURI, treasury: /^0x0{40}$/i.test(treasury) ? "" : treasury.toLowerCase(), treasuryShareBps })
      || same(treasury, input.from) || !same(input.from, rmtCreationOwner)) return null;
  return input;
}

export async function handleProductionCreation(request: Request) {
  const release = configuredCurveProductionRelease(request.headers);
  if (!release || request.method !== "POST" || !productionCreationEnabled() || !configuredProductionDiscovery(request.headers)) return reply({ status: "unavailable" }, 404);
  const url = new URL(request.url);
  if (url.origin !== release.origin || url.search) return reply({ status: "invalid" }, 403);
  const declared = request.headers.get("content-length");
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body
      || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 4096))) return reply({ status: "invalid" }, 400);
  try {
    const payload = await readDraftBody(request.body);
    if (payload.tooLarge) return reply({ status: "invalid" }, 413);
    const body = payload.input as Record<string, unknown> | null;
    if (keys(body, ["action"]) && body.action === "owner-login") {
      const { cookie, nonce, issuedAt } = issueOwnerReviewChallenge();
      const response = reply({ status: "owner-login", nonce, issuedAt });
      response.headers.set("Set-Cookie", cookie);
      return response;
    }
    if (keys(body, ["action", "fields", "account", "intentId", ...(body && Object.hasOwn(body, "prior") ? ["prior"] : [])]) && body.action === "prepare") {
      const prior = body.prior === undefined ? undefined : preparedRequest(body.prior);
      if (typeof body.account !== "string" || !/^0x[0-9a-f]{40}$/i.test(body.account)
          || !same(body.account, rmtCreationOwner) || !isTransactionHash(body.intentId) || !isRmtCreation(body.fields, body.intentId)
          || (body.prior !== undefined && !prior) || (prior && (!same(prior.from, body.account) || !same(prior.intentId, body.intentId)))) return reply({ status: "invalid" }, 422);
      if (!await isAuthenticatedCreationOwner(request.headers)) return reply({ status: "owner-login-required" }, 401);
      const cid = assetCID((body.fields as {projectURI:string}).projectURI,"metadata.json");
      if (cid !== "bafkreiazx4gbczh3uskiarktmoahm6mwt5ri243mmz2rfldak25yivjp5y" || !(await readArtwork(configuredArtworkStore(),cid,"logo.webp")).ok) return reply({status:"artwork-unverified"},422);
      if ((await readProductionDiscovery()).status !== "ready") return reply({ status: "unavailable" }, 503);
      return reply(await prepareCurveProductionCreation(release, body.fields, getAddress(body.account.toLowerCase()), body.intentId, prior ?? undefined));
    }
    if (keys(body, ["action", "request", ...(body && Object.hasOwn(body, "transactionHash") ? ["transactionHash"] : [])]) && body.action === "verify") {
      const original = preparedRequest(body.request);
      if (!original || (body.transactionHash !== undefined && !isTransactionHash(body.transactionHash))) return reply({ status: "invalid" }, 422);
      const { rpc, corroboratingRpc, anchor } = await verifyCurveProduction(release);
      const indexedReads = new Map<string, ReturnType<typeof readProductionDiscovery>>();
      const results = await Promise.all([rpc, corroboratingRpc].map(async (reader) => {
        const response = await verifyCanonicalCurveCreation({ deployment: { factory: productionCreationFactory,
        registry: curveProductionPins.registry[0], deploymentBlock: curveProductionDeployment.blockNumber,
        feeRecipient: curveProductionDeployment.operating }, chainId: 4663, request: original,
        transactionHash: body.transactionHash as Hex | undefined, rpc: reader,
        head: await reader.getBlock({ blockNumber: anchor.blockNumber }), readIndexed: async (token, hash, blockHash, logIndex) => {
          const key = token.toLowerCase();
          if (!indexedReads.has(key)) indexedReads.set(key, readProductionDiscovery(token));
          const evidence = await indexedReads.get(key)!;
          return evidence.status === "ready" && evidence.launches.some((launch) => same(launch.creation.transactionHash, hash)
            && same(launch.creation.blockHash, blockHash) && launch.creation.logIndex === logIndex);
        } });
        return { status: response.status, result: await response.json() as Record<string, unknown> };
      }));
      if (JSON.stringify(results[0]) !== JSON.stringify(results[1])) return reply({ status: "unavailable" });
      return reply({ ...results[0].result, paymentSettlement: "exact-value-registration-only", l1Finality: "unverified" }, results[0].status);
    }
    return reply({ status: "invalid" }, 400);
  } catch { return reply({ status: "unavailable" }); }
}
