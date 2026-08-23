import { canonicalUint256 } from "./domain.ts";

export const METADATA_FETCH_POLICY = Object.freeze({
  connectTimeoutMs: 2_000,
  totalTimeoutMs: 5_000,
  maxRedirects: 2,
  maxMetadataBytes: 1_000_000,
  maxMediaProbeBytes: 10_000_000,
  allowedSchemes: ["https:", "ipfs:", "data:"] as const
});

function privateIpv4(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function privateIpv6(host: string) {
  const value = host.replace(/^\[|\]$/g, "").toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
}

export function safeMetadataUri(raw: string) {
  const value = raw.trim();
  if (value.length === 0 || value.length > 8_192) throw new Error("Metadata URI length is invalid");
  if (value.startsWith("ipfs://")) {
    const cidPath = value.slice(7);
    if (!/^[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@\/-]*$/.test(cidPath)) throw new Error("IPFS URI is malformed");
    return value;
  }
  if (value.startsWith("data:")) {
    if (!/^data:application\/json(?:;charset=[^;,]+)?(?:;base64)?,/i.test(value)) throw new Error("Only JSON data URIs are accepted for metadata");
    if (value.length > METADATA_FETCH_POLICY.maxMetadataBytes * 2) throw new Error("Data URI is too large");
    return value;
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS, IPFS, and JSON data URIs are accepted");
  if (parsed.username || parsed.password) throw new Error("Metadata URL credentials are forbidden");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || privateIpv4(host) || privateIpv6(host)) {
    throw new Error("Metadata URL targets a private or local host");
  }
  return parsed.toString();
}

export function erc1155Uri(template: string, tokenId: string) {
  const id = BigInt(canonicalUint256(tokenId)).toString(16).padStart(64, "0");
  return template.replaceAll("{id}", id);
}

export type MetadataRefreshReason =
  | "first_seen"
  | "token_uri_changed"
  | "erc4906_metadata_update"
  | "erc4906_batch_metadata_update"
  | "erc1155_uri"
  | "manual_revalidation"
  | "source_conflict";

export type MetadataFetchRecord = {
  uri: string;
  resolvedUri: string;
  contentHash: string | null;
  httpEtag: string | null;
  observedAtMs: number;
  reason: MetadataRefreshReason;
  source: "contract" | "provider" | "blockscout";
  status: "ok" | "unavailable" | "unsafe_uri" | "oversize" | "invalid_json" | "conflicting";
};
