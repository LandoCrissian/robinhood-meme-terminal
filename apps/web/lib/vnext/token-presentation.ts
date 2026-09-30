import { z } from "zod";
import { isAddress } from "viem";
import type { RmtProjectIdentity } from "@rmt/shared/project-identity";

export type PresentationEvidence<T> = { state: "READY" | "STALE" | "UNAVAILABLE"; data: T | null; observedAt: string | null; provenance: string };
export type TokenIdentityPresentation = { name: string | null; symbol: string | null; decimals: number | null; contract: string };
export const visualSchema = z.object({ name: z.string().max(160).nullable(), symbol: z.string().max(40).nullable(), image: z.string().max(500).nullable(), description: z.string().max(4000).nullable(), websites: z.array(z.string().max(500)).max(5), twitter: z.string().max(80).nullable(), telegram: z.string().max(80).nullable(), provenance: z.literal("GECKOTERMINAL_TOKEN_INFO") });
export const chartMarketSchema = z.object({ token: z.string().refine(value => isAddress(value, { strict: false })), pool: z.string(), priceUsd: z.number().finite().nonnegative().nullable(), liquidityUsd: z.number().finite().nonnegative().nullable(), volume24hUsd: z.number().finite().nonnegative().nullable(), createdAt: z.string().nullable(), dex: z.string().nullable(), priceChange24h: z.number().finite().nullable(), buys24h: z.number().int().nonnegative().nullable(), sells24h: z.number().int().nonnegative().nullable() });
export type TokenVisualPresentation = z.infer<typeof visualSchema>;
export type TokenMarketPresentation = z.infer<typeof chartMarketSchema>;
export type TokenPresentation = {
  chainId: 4663;
  contract: string;
  identity: PresentationEvidence<TokenIdentityPresentation>;
  visual: PresentationEvidence<TokenVisualPresentation>;
  market: PresentationEvidence<TokenMarketPresentation>;
  project: PresentationEvidence<readonly RmtProjectIdentity[]>;
};

export function retainPresentationEvidence<T>(previous: PresentationEvidence<T> | undefined, next: PresentationEvidence<T>): PresentationEvidence<T> {
  return next.data === null && previous?.data !== null && previous?.data !== undefined
    ? { ...previous, state: "STALE" }
    : next;
}

export function parsePresentationEvidence<S extends z.ZodTypeAny>(value: unknown, contract: string, schema: S, provenance: string): PresentationEvidence<z.infer<S>> | null {
  const envelope = z.object({ chainId: z.literal(4663), contract: z.string(), state: z.enum(["READY", "STALE", "UNAVAILABLE"]), data: z.unknown(), observedAt: z.string().datetime().nullable(), provenance: z.literal(provenance) }).safeParse(value);
  if (!envelope.success || envelope.data.contract.toLowerCase() !== contract.toLowerCase()) return null;
  if (envelope.data.state !== "UNAVAILABLE" && (envelope.data.data === null || envelope.data.observedAt === null)) return null;
  const parsed = schema.nullable().safeParse(envelope.data.data);
  return parsed.success ? { state: envelope.data.state, data: parsed.data, observedAt: envelope.data.observedAt, provenance } : null;
}
