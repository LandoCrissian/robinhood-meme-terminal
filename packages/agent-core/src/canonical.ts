import { createHash } from "node:crypto";
import type { VerifiedPaperQuoteEvidence } from "./schema.ts";

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function hashCanonicalPayload(value: unknown): string {
  return `0x${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

export function hashPaperQuoteEvidence(
  quote: Omit<VerifiedPaperQuoteEvidence, "evidenceHash">,
): string {
  return hashCanonicalPayload(quote);
}
