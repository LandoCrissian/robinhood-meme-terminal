import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../apps/indexer/package.json", import.meta.url));
const viem = require("viem");
const { encodeFunctionData, decodeFunctionResult, keccak256, toEventSelector, toHex } = viem;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const bytesPattern = /^0x(?:[a-f0-9]{2})*$/i;
const addressPattern = /^0x[a-f0-9]{40}$/i;
export const nativeSourcePins = Object.freeze({
  chainId: 4663,
  collection: "0x7a543c61c021e9a5c7949faBdc2f4e0a58088daf",
  implementation: "0x09a26fc8fcef18192e267d7a6da9dfb4be81dd6a",
  validator: "0x721C008fdff27BF06E7E123956E2Fe03B63342e3",
  seaport: "0x0000000000000068F116a894984e2DB1123eB395",
  seaportRuntimeHash: "0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00",
  conduit: "0x963f00d3ff000064ffcba824b800c0000000c300",
  receiverCompatibilitySample: "0xAF9F10258b091719618c19D057F9cDAB72eFFd8b",
});
export const nativePublicTargets = Object.freeze({
  listingApi: "https://api.opensea.io/api/v2/listings/collection/lammbs-59693791/best?limit=1",
  collectionUi: "https://opensea.io/collection/lammbs-59693791",
  collectionSource: "https://sourcify.dev/server/v2/contract/4663/0x7a543c61c021e9a5c7949faBdc2f4e0a58088daf?fields=all",
  implementationSource: "https://sourcify.dev/server/v2/contract/4663/0x09a26fc8fcef18192e267d7a6da9dfb4be81dd6a?fields=all",
  validatorSource4663: "https://sourcify.dev/server/v2/contract/4663/0x721C008fdff27BF06E7E123956E2Fe03B63342e3?fields=all",
  validatorReferenceSource1: "https://sourcify.dev/server/v2/contract/1/0x721C008fdff27BF06E7E123956E2Fe03B63342e3?fields=all",
  alternativeRhinoMarket: "https://www.robinhoodnfts.com/marketplace/",
  alternativeHoodMarketDocs: "https://docs.hoodmarket.io/",
  alternativeAggregateUi: "https://radar.radiorelic.fun/",
});
const providers = Object.freeze({ official: "https://rpc.mainnet.chain.robinhood.com", pocket: "https://robinhood.api.pocket.network" });
const allowedUrls = new Set([...Object.values(nativePublicTargets), ...Object.values(providers)]);
const json = (value) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";

/** Public UI metadata only. Never execute a script, follow a URL from the body,
 * convert its floating-point price into payment calldata, or admit an order. */
export function extractPublicOpenSeaListingSummaries(html, { nowMs = Date.now() } = {}) {
  if (typeof html !== "string" || Buffer.byteLength(html) > 2 * 1024 * 1024) throw Error("PUBLIC_UI_BODY_BOUND");
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
  if (scripts.length > 512) throw Error("PUBLIC_UI_SCRIPT_BOUND");
  const result = []; let nodes = 0;
  function visit(value, depth = 0) {
    if (++nodes > 50000 || depth > 48) throw Error("PUBLIC_UI_STRUCTURE_BOUND");
    if (!value || typeof value !== "object") return;
    if (value.bestListing && value.chain?.identifier === "robinhood" &&
        value.contractAddress?.toLowerCase() === nativeSourcePins.collection.toLowerCase() &&
        /^(0|[1-9][0-9]{0,77})$/.test(value.tokenId ?? "") && ["ERC721", "ERC1155"].includes(value.standard)) {
      const listing = value.bestListing, currency = listing.pricePerItem?.token;
      if (currency?.contractAddress === "0x0000000000000000000000000000000000000000" &&
          currency?.chain?.identifier === "robinhood" && addressPattern.test(listing.maker?.address ?? "")) {
        const start = Date.parse(listing.startTime), end = Date.parse(listing.endTime);
        if (Number.isFinite(start) && Number.isFinite(end) && result.length < 64) result.push({
          tokenId: value.tokenId, standard: value.standard, collection: value.contractAddress,
          listingId: String(listing.id).slice(0, 96), seller: listing.maker.address,
          displayPriceEth: String(currency.unit), quantityRemaining: String(listing.quantityRemaining),
          startTime: listing.startTime, endTime: listing.endTime,
          reportedCurrentAtObservation: start <= nowMs && nowMs < end,
          sourceClassification: "PUBLIC_UI_LISTING_CLAIM_NOT_SIGNED_ORDER",
          fullOrderParametersAvailable: false, signatureAvailable: false,
          executionApproved: false,
        });
      }
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  for (const [, script] of scripts) {
    if (!script.startsWith('(window[Symbol.for("urql_transport")]') || !script.includes("bestListing")) continue;
    const at = script.indexOf(".push("), end = script.lastIndexOf(")");
    if (at < 0 || end < at || script.length > 1024 * 1024) throw Error("PUBLIC_UI_TRANSPORT_BOUND");
    visit(JSON.parse(script.slice(at + 6, end)));
  }
  return result;
}

export function compareSourceTemplate(source, actualRuntime) {
  const hosted = source?.runtimeBytecode?.onchainBytecode;
  if (!bytesPattern.test(hosted ?? "") || !bytesPattern.test(actualRuntime ?? "")) throw Error("SOURCE_RUNTIME_UNAVAILABLE");
  const refs = source.runtimeBytecode.immutableReferences ?? {};
  const a = Buffer.from(hosted.slice(2), "hex"), b = Buffer.from(actualRuntime.slice(2), "hex");
  if (a.length !== b.length) return { fullRuntimeEqualsHostedSource: false, executableOutsideImmutablesEqual: false, lengthMismatch: true };
  const mask = Buffer.alloc(a.length), immutableValues = {};
  for (const [id, ranges] of Object.entries(refs)) {
    if (!Array.isArray(ranges) || ranges.length > 64) throw Error("SOURCE_IMMUTABLE_BOUND");
    const values = [];
    for (const { start, length } of ranges) {
      if (!Number.isSafeInteger(start) || length !== 32 || start < 0 || start + length > a.length) throw Error("SOURCE_IMMUTABLE_BOUND");
      mask.fill(1, start, start + length); values.push("0x" + b.subarray(start, start + length).toString("hex"));
    }
    immutableValues[id] = [...new Set(values)];
  }
  const differencesOutsideImmutables = [];
  for (let i = 0; i < a.length; i++) if (!mask[i] && a[i] !== b[i] && differencesOutsideImmutables.length < 32) differencesOutsideImmutables.push(i);
  return { fullRuntimeEqualsHostedSource: a.equals(b), executableOutsideImmutablesEqual: differencesOutsideImmutables.length === 0,
    differencesOutsideImmutables, immutableValues, independentlyRecompiled: false,
    limitation: "Hosted source/runtime correspondence is not independent recompilation or acceptance of immutable bindings, management modules or policy." };
}

/** Fixed, credential-free GET and JSON-RPC reads. No browser session, arbitrary
 * endpoint, wallet/provider signer, signature request or submission method. */
export async function probeCurrentNativeSources({ fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const raw = [], report = { schemaVersion: 1, scope: "READ_ONLY_CURRENT_SOURCE_AND_COLLECTION_QUALIFICATION",
    status: "BLOCKED_NO_BROADCAST", observedAt: new Date(nowMs).toISOString(), broadcast: false,
    ownerSignatures: false, executionApproved: false, currentExecutableListingVerified: false,
    collectionPurchaseAdmitted: false, publicSources: {}, providers: {}, limitations: [] };
  async function get(url, maxBytes = 2 * 1024 * 1024, body) {
    if (!allowedUrls.has(url)) throw Error("FIXED_PUBLIC_TARGET_REQUIRED");
    const method = body ? "POST" : "GET", headers = body ? { "content-type": "application/json" } : { accept: "application/json,text/html" };
    try {
      const response = await fetchImpl(url, { method, headers, credentials: "omit", redirect: "error",
        signal: AbortSignal.timeout(10000), ...(body ? { body: JSON.stringify(body) } : {}) });
      const reader = response.body?.getReader(), chunks = []; let bytes = 0;
      try { if (reader) for (;;) { const next = await reader.read(); if (next.done) break;
        bytes += next.value.length; if (bytes > maxBytes) throw Error("PUBLIC_RESPONSE_BOUND"); chunks.push(next.value); }
      } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
      const buffer = Buffer.concat(chunks), text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      const record = { url, method, credentials: "omit", redirect: "error", apiCredentialUsed: false,
        observedAt: new Date().toISOString(), httpStatus: response.status, responseDate: response.headers.get("date"),
        contentType: response.headers.get("content-type"), bytes, sha256: sha(buffer), ...(body ? { request: body } : {}), rawUtf8: text };
      raw.push(record); return { ...record, text, ok: response.ok };
    } catch (error) { const record = { url, method, observedAt: new Date().toISOString(), status: "UNAVAILABLE", reason: String(error.message).slice(0,160) };
      raw.push(record); return record; }
  }
  const pages = {};
  for (const [name, url] of Object.entries(nativePublicTargets)) {
    const response = await get(url); pages[name] = response;
    const { text: _text, rawUtf8: _raw, ...metadata } = response; report.publicSources[name] = metadata;
  }
  let listingClaims = [];
  if (pages.collectionUi.ok) {
    try { listingClaims = extractPublicOpenSeaListingSummaries(pages.collectionUi.text, { nowMs }); }
    catch (error) { report.publicSources.collectionUi.parseFailure = String(error.message).slice(0,160); }
  }
  report.publicUiListingClaims = listingClaims;
  report.publicUiVerdict = listingClaims.length ? "NATIVE_LISTING_SUMMARIES_OBSERVED_FULL_SIGNED_ORDER_UNAVAILABLE" : "NO_QUALIFIABLE_SIGNED_ORDER_OBSERVED";
  let id = 0;
  async function rpc(name, method, params) {
    if (!["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_getLogs", "eth_call"].includes(method)) throw Error("READ_ONLY_METHOD_REQUIRED");
    if (++id > 112 || JSON.stringify(params).length > 8192) throw Error("READ_BUDGET");
    const response = await get(providers[name], 256 * 1024, { jsonrpc: "2.0", id, method, params });
    if (!response.ok) throw Error("RPC_TRANSPORT_UNAVAILABLE");
    const parsed = JSON.parse(response.text);
    if (parsed.error) return { error: parsed.error };
    if (!Object.hasOwn(parsed, "result") || parsed.result === null) throw Error("RPC_RESULT_UNAVAILABLE");
    return { value: parsed.result };
  }
  try {
    const tips = await Promise.all(Object.keys(providers).map(async name => {
      const chain = await rpc(name, "eth_chainId", []); if (chain.value !== "0x1237") throw Error("CHAIN_MISMATCH");
      const tip = await rpc(name, "eth_getBlockByNumber", ["latest", false]); return BigInt(tip.value.number);
    }));
    const anchor = tips.reduce((a,b) => a < b ? a : b) - 8n, tag = toHex(anchor), start = anchor - 9999n;
    report.anchor = anchor.toString();
    const implementationSource = pages.implementationSource.ok ? JSON.parse(pages.implementationSource.text) : null;
    const validatorReference = pages.validatorReferenceSource1.ok ? JSON.parse(pages.validatorReferenceSource1.text) : null;
    if (!implementationSource?.abi || !validatorReference?.abi) throw Error("COLLECTION_SOURCE_UNAVAILABLE");
    const artifacts = JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/rmt-task082/seaport-marketplace/seaport-compiled.json.gz", import.meta.url))));
    const event = artifacts.artifacts.Seaport.abi.find(item => item.type === "event" && item.name === "OrderValidated");
    const candidate = listingClaims.find(item => item.tokenId === "478" && item.reportedCurrentAtObservation);
    for (const name of Object.keys(providers)) {
      const point = { block: (await rpc(name, "eth_getBlockByNumber", [tag, false])).value, code: {}, reads: [] };
      for (const role of ["collection", "implementation", "validator", "seaport"]) {
        const result = await rpc(name, "eth_getCode", [nativeSourcePins[role], tag]);
        if (!bytesPattern.test(result.value ?? "") || result.value === "0x") throw Error("RUNTIME_UNAVAILABLE");
        point.code[role] = { address: nativeSourcePins[role], runtimeHash: keccak256(result.value), bytes: (result.value.length - 2) / 2 };
        if (role === "collection") point.code[role].runtime = result.value;
        if (role === "implementation") point.code[role].sourceCorrespondence = compareSourceTemplate(implementationSource, result.value);
        if (role === "validator") point.code[role].ethereumReferenceCorrespondence = compareSourceTemplate(validatorReference, result.value);
      }
      const exactClone = "0x363d3d373d3d3d363d73" + nativeSourcePins.implementation.slice(2).toLowerCase() + "5af43d82803e903d91602b57fd5bf3";
      if (point.code.collection.runtime.toLowerCase() !== exactClone) throw Error("COLLECTION_IMPLEMENTATION_BINDING_MISMATCH");
      if (!point.code.implementation.sourceCorrespondence.fullRuntimeEqualsHostedSource) throw Error("IMPLEMENTATION_SOURCE_RUNTIME_MISMATCH");
      if (point.code.seaport.runtimeHash !== nativeSourcePins.seaportRuntimeHash) throw Error("SEAPORT_RUNTIME_MISMATCH");
      async function call(abi, to, functionName, args = [], from) {
        const transaction = { to, data: encodeFunctionData({ abi, functionName, args }), ...(from ? { from } : {}) };
        const result = await rpc(name, "eth_call", [transaction, tag]);
        const value = result.error ? { error: result.error } : decodeFunctionResult({ abi, functionName, data: result.value });
        point.reads.push({ to, ...(from ? { from } : {}), functionName, args, value }); return value;
      }
      const collection = nativeSourcePins.collection, validator = nativeSourcePins.validator;
      for (const [fn,args] of [["name",[]],["owner",[]],["getTransferValidator",[]],["supportsInterface",["0x80ac58cd"]],
        ["supportsInterface",["0xd9b67a26"]],["royaltyInfo",[478n,10n**18n]],["maxSupply",[]],["totalSupply",[]]]) {
        const value = await call(implementationSource.abi,collection,fn,args);
        if (fn === "getTransferValidator" && value?.toLowerCase() !== validator.toLowerCase()) throw Error("COLLECTION_VALIDATOR_BINDING_MISMATCH");
      }
      await call(validatorReference.abi, validator, "owner");
      await call(validatorReference.abi, validator, "getCollectionSecurityPolicy", [collection]);
      await call(validatorReference.abi, validator, "boundRuleset", [0]);
      if (candidate) {
        const tokenId = BigInt(candidate.tokenId), seller = candidate.seller;
        await call(implementationSource.abi,collection,"ownerOf",[tokenId]);
        await call(implementationSource.abi,collection,"getApproved",[tokenId]);
        for (const operator of [nativeSourcePins.seaport, nativeSourcePins.conduit]) {
          await call(implementationSource.abi,collection,"isApprovedForAll",[seller,operator]);
          await call(validatorReference.abi,validator,"validateTransfer",[operator,seller,nativeSourcePins.receiverCompatibilitySample,tokenId],collection);
        }
      }
      const filter = { address: nativeSourcePins.seaport, fromBlock: toHex(start), toBlock: tag, topics: [toEventSelector(event)] };
      const validated = await rpc(name,"eth_getLogs",[filter]);
      if (!Array.isArray(validated.value) || validated.value.length > 100) throw Error("RECENT_VALIDATED_LOG_BOUND_OR_UNAVAILABLE");
      point.recentOrderValidated = { filter, maxLogs: 100, count: validated.value.length, logs: validated.value,
        verdict: validated.value.length ? "PUBLIC_VALIDATION_LOGS_REQUIRE_EXACT_VALIDATE_CALLDATA_AND_CURRENT_ORDER_PROOF" : "NO_VALIDATED_ORDER_IN_BOUNDED_RECENT_WINDOW" };
      const again = (await rpc(name,"eth_getBlockByNumber",[tag,false])).value;
      if (again.hash !== point.block.hash) throw Error("REORG_DURING_OBSERVATION");
      point.canonicalRechecked = true; report.providers[name] = point;
    }
    if (json(report.providers.official) !== json(report.providers.pocket)) throw Error("PROVIDER_DISAGREEMENT");
    report.corroborated = true;
    report.collectionVerdict = "NO_GO_MUTABLE_TRANSFER_POLICY_AND_UNADMITTED_VALIDATOR_CLOSURE_NO_OWNER_COLLECTION_APPROVAL";
    report.candidateListingClaim = candidate ?? null;
    report.sourcePolicy = { implementationName: implementationSource.compilation.name,
      compilerVersion: implementationSource.compilation.compilerVersion, independentCompilationPerformed: false,
      ownerMutableTransferValidator: true, ownerMutableRoyalty: true, ownerMutableMaxSupply: true,
      custodySeizureEntrypointFoundInReviewedCollectionSource: false,
      reviewBoundary: "Source inspection is limited to hosted implementation source; validator/module/issuer authority and actual signed-order custody require separate admission. This is purchase eligibility, not Reclaim burn eligibility." };
  } catch (error) { report.chainObservationFailure = String(error.message).slice(0,160); report.corroborated = false; }
  report.verdict = "NO_CURRENT_EXECUTABLE_SIGNED_NATIVE_ORDER_ADMITTED";
  report.limitations = [
    "Public UI native-ETH listing summaries were observed where available; they omit full signed consideration, Seaport parameters and seller signature. Never treat display prices as exact payment amounts.",
    "The documented OpenSea API401 boundary is final: no key, account, authenticated backend, cookie reuse, private GraphQL or bypass was attempted.",
    "A bounded recent OrderValidated query is not an exhaustive history scan, and a log alone is not current seller authority. No historical fill is relabeled as a current listing.",
    "The collection clone has fixed implementation routing but mutable transfer-validator and royalty settings. Hosted source matching is not an independent audit or owner collection approval.",
    "No real listing execution, wallet signature, transaction, production admission, finality verification or purchase was performed. The existing vault remains31337-only and production NO_GO.",
  ];
  return { report, raw };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error("Use probe-current-native-sources.mjs <isolated-output-directory>");
  const output = resolve(process.argv[2]); mkdirSync(output,{recursive:true});
  const { report, raw } = await probeCurrentNativeSources();
  const rawBytes = Buffer.from(json(raw)), reportBytes = Buffer.from(json(report));
  writeFileSync(resolve(output,"current-native-source-observation.json"),reportBytes);
  writeFileSync(resolve(output,"raw-public-source-responses.json.gz"),gzipSync(rawBytes,{level:9}));
  writeFileSync(resolve(output,"probe-manifest.json"),json({ schemaVersion:1,status:"BLOCKED_NO_BROADCAST",observedAt:report.observedAt,
    scriptSha256:sha(readFileSync(fileURLToPath(import.meta.url))),reportSha256:sha(reportBytes),rawSha256:sha(rawBytes),
    rawBytes:rawBytes.length,rawResponses:raw.length,scannerStatus:"REQUIRES_UNCHANGED_RAW_SCAN_AND_EXACT_PUBLIC_DATA_CLASSIFICATION_BEFORE_COMMIT" }));
  console.log(json({ output, verdict:report.verdict, corroborated:report.corroborated,listingClaims:report.publicUiListingClaims.length,
    currentExecutableListingVerified:false,status:report.status }));
}
