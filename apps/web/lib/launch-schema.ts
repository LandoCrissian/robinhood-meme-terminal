import { z } from "zod";

export const launchSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(40),
  symbol: z.string().trim().min(2, "Ticker must be at least 2 characters").max(10).regex(/^[A-Z0-9]+$/, "Use uppercase letters and numbers only"),
  supply: z.string().refine((value) => value === "1000000000", "Launch supply is fixed at 1 billion tokens"),
  description: z.string().trim().min(10, "Description must be at least 10 characters").max(500),
  website: z.string().trim().url("Enter a complete website URL beginning with https://").refine((value) => value === "" || value.startsWith("https://"), "Website must use https://").or(z.literal("")),
  x: z.string().trim().url("Enter a complete X URL beginning with https://").refine((value) => value === "" || value.startsWith("https://"), "X link must use https://").or(z.literal("")),
  telegram: z.string().trim().url("Enter a complete Telegram URL beginning with https://").refine((value) => value === "" || value.startsWith("https://"), "Telegram link must use https://").or(z.literal("")),
  communityTreasury: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid community treasury address"),
  traderRewards: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid trader rewards address"),
  liquidityVault: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid liquidity vault address"),
  platformTreasury: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid platform treasury address"),
  accepted: z.boolean().refine((value) => value, "Confirm the permanent token rules")
});

export type LaunchFormValues = z.infer<typeof launchSchema>;
