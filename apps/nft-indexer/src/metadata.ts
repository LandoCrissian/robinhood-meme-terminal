import { createHash } from "node:crypto";
import type { RmtNftItemMetadata, RmtNftTokenUriKind } from "@rmt/shared/nft/project-inventory";

export const MAX_TOKEN_URI_BYTES = 256 * 1024;
export const MAX_METADATA_JSON_BYTES = 128 * 1024;
export const MAX_SVG_BYTES = 256 * 1024;
const MAX_ATTRIBUTES = 64;

function unavailable(kind: RmtNftTokenUriKind, status: "UNAVAILABLE" | "INVALID" | "UNSUPPORTED", digest: `0x${string}` | null): RmtNftItemMetadata {
  return { authority: "ONCHAIN_TOKEN_URI", status, tokenUriKind: kind, name: null, description: null, image: null, attributes: [], metadataDigest: digest };
}

function digest(value: string): `0x${string}` {
  return `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function utf8(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function strictBase64(value: string, maximum: number) {
  if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Malformed base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength > maximum || bytes.toString("base64") !== value) throw new Error("Invalid or oversized base64");
  return bytes;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > maximum) throw new Error("Invalid metadata text");
  return value;
}

function safeObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectPollutionKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectPollutionKeys(item);
    return;
  }
  if (!safeObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Unsafe metadata key");
    rejectPollutionKeys(item);
  }
}

function safeSvgDataUri(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("data:image/svg+xml;base64,")) return null;
  const encoded = value.slice("data:image/svg+xml;base64,".length);
  const bytes = strictBase64(encoded, MAX_SVG_BYTES);
  const svg = utf8(bytes);
  if (!/^\s*<svg\b[\s\S]*<\/svg>\s*$/.test(svg)) throw new Error("Malformed SVG");
  if (/<\/?(?:script|foreignObject|image|use|style|iframe|object|embed|audio|video|a)\b/i.test(svg)
    || /\son[a-z]+\s*=/i.test(svg) || /javascript\s*:/i.test(svg)
    || /\b(?:href|src)\s*=/i.test(svg) || /url\s*\(/i.test(svg)) throw new Error("Unsafe SVG");
  const tags = [...svg.matchAll(/<\/?([A-Za-z][\w:-]*)\b/g)].map((match) => match[1]!.toLowerCase());
  if (tags.some((tag) => !["svg", "rect"].includes(tag))) throw new Error("Unsupported SVG element");
  for (const element of svg.matchAll(/<(svg|rect)\b([^>]*)>/gi)) {
    const tag = element[1]!.toLowerCase();
    const attributes = element[2]!;
    const allowed = new Set(tag === "svg" ? ["xmlns", "width", "height", "viewBox"] : ["x", "y", "width", "height", "fill", "rx", "ry"]);
    let remainder = attributes;
    for (const attribute of attributes.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g)) {
      if (!allowed.has(attribute[1]!)) throw new Error("Unsupported SVG attribute");
      remainder = remainder.replace(attribute[0], "");
    }
    if (remainder.replace(/\//g, "").trim()) throw new Error("Malformed SVG attribute");
  }
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export function classifyTokenUri(tokenUri: string): RmtNftTokenUriKind {
  if (tokenUri.startsWith("data:application/json;base64,")) return "DATA_JSON_BASE64";
  if (tokenUri.startsWith("ipfs://")) return "IPFS";
  if (tokenUri.startsWith("https://")) return "HTTPS";
  return "OTHER";
}

export function resolveOnchainTokenMetadata(tokenUri: unknown): RmtNftItemMetadata {
  if (typeof tokenUri !== "string") return unavailable("OTHER", "UNAVAILABLE", null);
  const kind = classifyTokenUri(tokenUri);
  const evidenceDigest = Buffer.byteLength(tokenUri, "utf8") <= MAX_TOKEN_URI_BYTES ? digest(tokenUri) : null;
  if (kind === "IPFS" || kind === "HTTPS") return unavailable(kind, "UNSUPPORTED", evidenceDigest);
  if (kind !== "DATA_JSON_BASE64") return unavailable(kind, "INVALID", evidenceDigest);
  try {
    if (Buffer.byteLength(tokenUri, "utf8") > MAX_TOKEN_URI_BYTES) throw new Error("Oversized token URI");
    const encoded = tokenUri.slice("data:application/json;base64,".length);
    const jsonBytes = strictBase64(encoded, MAX_METADATA_JSON_BYTES);
    const parsed: unknown = JSON.parse(utf8(jsonBytes));
    if (!safeObject(parsed)) throw new Error("Metadata must be an object");
    rejectPollutionKeys(parsed);
    const rawAttributes = parsed.attributes ?? [];
    if (!Array.isArray(rawAttributes) || rawAttributes.length > MAX_ATTRIBUTES) throw new Error("Invalid attributes");
    const attributes = rawAttributes.map((attribute) => {
      if (!safeObject(attribute)) throw new Error("Invalid attribute");
      const traitType = boundedText(attribute.trait_type, 120);
      const value = typeof attribute.value === "string" || typeof attribute.value === "number"
        ? String(attribute.value) : null;
      if (traitType === null || value === null || value.length > 500) throw new Error("Invalid attribute");
      return { traitType, value };
    });
    let image: string | null = null;
    try {
      image = safeSvgDataUri(parsed.image);
    } catch {
      image = null;
    }
    return {
      authority: "ONCHAIN_TOKEN_URI",
      status: "READY",
      tokenUriKind: kind,
      name: boundedText(parsed.name, 200),
      description: boundedText(parsed.description, 2_000),
      image,
      attributes,
      metadataDigest: evidenceDigest,
    };
  } catch {
    return unavailable(kind, "INVALID", evidenceDigest);
  }
}
