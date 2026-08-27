import { createHash } from "node:crypto";
import type { Hex } from "viem";
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Evidence JSON contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  }
  throw new Error("Evidence JSON contains an unsupported value.");
}
export function evidenceDigest(value: unknown): Hex {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}` as Hex;
}
export function boundedError(error: unknown) {
  const text = (error instanceof Error ? error.message : String(error))
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, " ");
  return (text || "Unknown marketplace ingestion error.").slice(0, 4096);
}
