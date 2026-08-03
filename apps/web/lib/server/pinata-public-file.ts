import { keccak256, toHex } from "viem";
import {
  creatorMetadataBytes,
  isPublicIpfsCid,
  type CreatorMediaReceipt,
  type CreatorMediaRetrievalCheck
} from "../creator-media-receipt";
import type { CreatorMediaManifest } from "../creator-media-manifest";

type PinataFile = {
  id?: unknown;
  cid?: unknown;
  size?: unknown;
  network?: unknown;
};

function pinataJwt() {
  const jwt = process.env.PINATA_JWT?.trim() ?? "";
  if (jwt.length < 40) throw new Error("storage_unconfigured");
  return jwt;
}

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

function verificationGateway() {
  const configured = (
    process.env.CREATOR_IPFS_VERIFICATION_GATEWAY
    ?? process.env.NEXT_PUBLIC_IPFS_GATEWAY
    ?? "https://ipfs.io/ipfs/"
  ).trim();
  const url = new URL(configured);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) throw new Error("retrieval_gateway_invalid");
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/ipfs")) throw new Error("retrieval_gateway_invalid");
  return {
    base: `${url.origin}${pathname}/`,
    origin: url.origin
  };
}

function gatewayUrl(base: string, cid: string, path: string | null) {
  const suffix = path
    ? `/${path.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`
    : "";
  return `${base}${cid}${suffix}`;
}

async function readBoundedBody(response: Response, maxBytes: number, allowTruncate: boolean) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (!allowTruncate && Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("retrieval_too_large");
  }
  if (!response.body) throw new Error("retrieval_empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = maxBytes - total;
      if (next.value.byteLength > remaining) {
        if (!allowTruncate) throw new Error("retrieval_too_large");
        chunks.push(next.value.slice(0, remaining));
        total = maxBytes;
        break;
      }
      total += next.value.byteLength;
      chunks.push(next.value);
      if (allowTruncate && total === maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (total < 1) throw new Error("retrieval_empty");
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function retrieve(
  url: string,
  maxBytes: number,
  range = false
) {
  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      ...(range ? { Range: `bytes=0-${maxBytes - 1}` } : {})
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error("retrieval_failed");
  const contentType = (response.headers.get("content-type") ?? "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!contentType || contentType === "text/html") throw new Error("retrieval_content_type");
  return {
    contentType,
    bytes: await readBoundedBody(response, maxBytes, range)
  };
}

async function retrieveWithRetry(
  url: string,
  maxBytes: number,
  range = false
) {
  let lastError: unknown;
  for (const delay of [0, 400, 1_200]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await retrieve(url, maxBytes, range);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("retrieval_failed");
}

async function verifyPublicRetrieval(
  manifest: CreatorMediaManifest,
  metadataCid: string
) {
  const gateway = verificationGateway();
  const expectedMetadata = new TextEncoder().encode(creatorMetadataBytes(manifest));
  const metadataResult = await retrieveWithRetry(
    gatewayUrl(gateway.base, metadataCid, null),
    64_000
  );
  if (
    metadataResult.bytes.byteLength !== expectedMetadata.byteLength
    || !metadataResult.bytes.every((byte, index) => byte === expectedMetadata[index])
  ) throw new Error("retrieval_metadata_mismatch");
  const checks: CreatorMediaRetrievalCheck[] = [{
    role: "metadata",
    uri: `ipfs://${metadataCid}`,
    contentType: metadataResult.contentType,
    bytesRead: metadataResult.bytes.byteLength,
    exactBytesVerified: true,
    status: "retrieved"
  }];
  for (const reference of manifest.media) {
    if (!reference.cid) throw new Error("retrieval_reference_invalid");
    const result = await retrieveWithRetry(
      gatewayUrl(gateway.base, reference.cid, reference.path),
      4_096,
      true
    );
    checks.push({
      role: reference.role,
      uri: reference.uri,
      contentType: result.contentType,
      bytesRead: result.bytes.byteLength,
      exactBytesVerified: false,
      status: "retrieved"
    });
  }
  return {
    retrievalGatewayOrigin: gateway.origin,
    retrievalChecks: checks
  };
}

export async function pinAndVerifyCreatorMetadata(manifest: CreatorMediaManifest) {
  const bytes = creatorMetadataBytes(manifest);
  const file = new File(
    [bytes],
    `${manifest.projectSlug}-${manifest.assetId}-${manifest.manifestHash.slice(2, 10)}.json`,
    { type: "application/json" }
  );
  const form = new FormData();
  form.set("network", "public");
  form.set("file", file);
  form.set("name", file.name);
  form.set("keyvalues", JSON.stringify({
    rmt_schema: "creator_metadata_v1",
    project_slug: manifest.projectSlug,
    asset_id: manifest.assetId,
    revision: manifest.draftRevisionHash,
    manifest: manifest.manifestHash
  }));
  const jwt = pinataJwt();
  const uploadResponse = await fetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
    signal: AbortSignal.timeout(20_000)
  });
  const uploadBody = await readJson(uploadResponse) as { data?: PinataFile } | null;
  const uploaded = uploadBody?.data;
  if (
    !uploadResponse.ok
    || typeof uploaded?.id !== "string"
    || !isPublicIpfsCid(uploaded.cid)
    || uploaded.size !== file.size
  ) throw new Error("storage_upload_failed");

  const query = new URL("https://api.pinata.cloud/v3/files/public");
  query.searchParams.set("cid", uploaded.cid);
  query.searchParams.set("limit", "10");
  const verifyResponse = await fetch(query, {
    headers: { Authorization: `Bearer ${jwt}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000)
  });
  const verifyBody = await readJson(verifyResponse) as {
    data?: { files?: PinataFile[] };
  } | null;
  const verified = verifyBody?.data?.files?.find((candidate) => (
    candidate.id === uploaded.id
    && candidate.cid === uploaded.cid
    && candidate.size === file.size
  ));
  if (!verifyResponse.ok || !verified) throw new Error("storage_verification_failed");
  const retrieval = await verifyPublicRetrieval(manifest, uploaded.cid);
  return {
    metadataCid: uploaded.cid,
    providerFileId: uploaded.id,
    storedSize: file.size,
    ...retrieval
  };
}

function retrievalTarget(base: string, uri: string) {
  if (!uri.startsWith("ipfs://")) throw new Error("availability_uri_invalid");
  const [cid, ...path] = uri.slice(7).split("/");
  if (!isPublicIpfsCid(cid)) throw new Error("availability_uri_invalid");
  return gatewayUrl(base, cid, path.length ? path.join("/") : null);
}

function availabilityFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "availability_failed";
  return /^[a-z0-9_]{3,80}$/.test(message) ? message : "availability_failed";
}

export async function checkCreatorMediaAvailability(receipt: CreatorMediaReceipt) {
  const gateway = verificationGateway();
  const jwt = pinataJwt();
  const providerCheck = (async () => {
    const query = new URL("https://api.pinata.cloud/v3/files/public");
    query.searchParams.set("cid", receipt.metadataCid);
    query.searchParams.set("limit", "10");
    try {
      const response = await fetch(query, {
        headers: { Authorization: `Bearer ${jwt}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) return { passed: false, state: "unknown" as const, failure: "provider_unavailable" };
      const body = await readJson(response) as { data?: { files?: PinataFile[] } } | null;
      const verified = body?.data?.files?.some((file) => (
        file.id === receipt.providerFileId
        && file.cid === receipt.metadataCid
        && file.size === receipt.storedSize
      ));
      return verified
        ? { passed: true, state: "verified" as const, failure: "" }
        : { passed: false, state: "missing" as const, failure: "provider_record_missing" };
    } catch {
      return { passed: false, state: "unknown" as const, failure: "provider_unavailable" };
    }
  })();
  const retrievalChecks = receipt.retrievalChecks.map(async (check) => {
    try {
      const metadata = check.role === "metadata";
      const result = await retrieve(
        retrievalTarget(gateway.base, check.uri),
        metadata ? receipt.storedSize : 4_096,
        !metadata
      );
      if (metadata) {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(result.bytes);
        if (
          result.bytes.byteLength !== receipt.storedSize
          || keccak256(toHex(text)) !== receipt.metadataHash
        ) throw new Error("metadata_hash_mismatch");
      }
      return { passed: true, role: check.role, failure: "" };
    } catch (error) {
      return { passed: false, role: check.role, failure: availabilityFailure(error) };
    }
  });
  const [provider, ...retrieval] = await Promise.all([providerCheck, ...retrievalChecks]);
  const passedRetrieval = retrieval.filter((check) => check.passed).length;
  const metadataAvailable = retrieval.find((check) => check.role === "metadata")?.passed === true;
  const gatewayState = passedRetrieval === retrieval.length
    ? "available" as const
    : passedRetrieval > 0
      ? "partial" as const
      : "unavailable" as const;
  const overallState = provider.passed && gatewayState === "available"
    ? "healthy" as const
    : provider.state === "missing" || !metadataAvailable
      ? "unavailable" as const
      : "degraded" as const;
  const failureCode = [
    provider.failure,
    ...retrieval.filter((check) => !check.passed).map((check) => `${check.role}_${check.failure}`)
  ].filter(Boolean).join(",").slice(0, 80);
  return {
    providerState: provider.state,
    gatewayState,
    overallState,
    checksAttempted: 1 + retrieval.length,
    checksPassed: Number(provider.passed) + passedRetrieval,
    failureCode
  };
}
