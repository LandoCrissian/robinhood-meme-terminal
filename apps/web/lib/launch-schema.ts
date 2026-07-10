import { z } from "zod";

export const launchSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(40),
  symbol: z.string().trim().min(2, "Ticker must be at least 2 characters").max(10).regex(/^[A-Z0-9]+$/, "Use uppercase letters and numbers only"),
  supply: z.string().regex(/^\d+$/, "Supply must be a whole number").refine((value) => BigInt(value) > 0n, "Supply must be greater than zero"),
  description: z.string().trim().min(10, "Description must be at least 10 characters").max(500),
  communityTreasury: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid community treasury address"),
  traderRewards: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid trader rewards address"),
  liquidityVault: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid liquidity vault address"),
  platformTreasury: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid platform treasury address"),
  accepted: z.literal(true, { errorMap: () => ({ message: "Confirm the permanent token rules" }) })
});

export type LaunchFormValues = z.infer<typeof launchSchema>;
