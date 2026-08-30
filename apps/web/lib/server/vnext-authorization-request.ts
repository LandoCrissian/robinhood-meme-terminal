import { isAddress } from "viem";
import { z } from "zod";

export const vNextAuthorizationRequestSchema = z.object({
  chainId: z.literal(4_663),
  quoteRequestId: z.string().uuid(),
  verificationId: z.string().uuid(),
  provider: z.enum(["sushi", "uniswap-v2", "uniswap-v3", "uniswap-v4", "up-v2", "up-cl"]),
  inputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  outputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  inputAmountAtomic: z.string().regex(/^[1-9][0-9]*$/),
  recipient: z.string().refine((value) => isAddress(value, { strict: false })),
  expectedStatus: z.enum(["approval_required", "verified"]),
  indicativeProtectedOutputFloorAtomic: z.string().regex(/^[1-9][0-9]*$/),
  expectedProtectedOutputAtomic: z.string().regex(/^[1-9][0-9]*$/),
  executionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  canonicalMarket: z.object({ sourceId: z.literal("uniswap-v4"), poolId: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).optional(),
  v4QuoteEvidence: z.object({
    poolId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    currency0: z.string().refine((value) => isAddress(value, { strict: false })),
    currency1: z.string().refine((value) => isAddress(value, { strict: false })),
    fee: z.number().int().nonnegative().max(16_777_215),
    tickSpacing: z.number().int().positive().max(32_767),
    hooks: z.string().refine((value) => isAddress(value, { strict: false })),
    recipient: z.string().refine((value) => isAddress(value, { strict: false })),
    observedBlock: z.string().regex(/^[1-9][0-9]*$/),
    observedBlockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    observedAtMs: z.number().int().positive(),
    quotedAtMs: z.number().int().positive(),
    expiresAtMs: z.number().int().positive()
  }).optional()
}).strict();
