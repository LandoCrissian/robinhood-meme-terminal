import { normalizePrivyAppId } from "./privy-config";

export type PrivyFundingEnvironment = "sandbox" | "production";

export type PrivyFundingConfig = {
  enabled: boolean;
  chain: `eip155:${number}`;
  asset: `0x${string}`;
  assetLabel: string;
  defaultAmount: string;
  environment: PrivyFundingEnvironment;
};

export type PrivyFundingPublicEnv = {
  appId?: string;
  enabled?: string;
  chainId?: string;
  asset?: string;
  defaultAmount?: string;
  environment?: string;
};

const TOKEN_ADDRESS = /^0x[0-9a-f]{40}$/i;
const NATIVE_ASSET = "0x0000000000000000000000000000000000000000";

export function parsePrivyFundingConfig(env: PrivyFundingPublicEnv): PrivyFundingConfig {
  const chainId = Number(env.chainId ?? "4663");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Privy funding requires a positive EVM chain ID.");
  }

  const asset = (env.asset ?? NATIVE_ASSET).trim();
  if (!TOKEN_ADDRESS.test(asset)) {
    throw new Error("Privy funding requires an exact destination token address. Use the zero address for native ETH.");
  }

  const requestedAmount = (env.defaultAmount ?? "50").trim();
  const amount = Number(requestedAmount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 10_000) {
    throw new Error("Privy funding default amount must be between 1 and 10,000 fiat units.");
  }

  const environment = env.environment === "production" ? "production" : "sandbox";

  return {
    enabled: Boolean(normalizePrivyAppId(env.appId)) && env.enabled === "true",
    chain: `eip155:${chainId}`,
    asset: asset as `0x${string}`,
    assetLabel: asset.toLowerCase() === NATIVE_ASSET ? "ETH" : `${asset.slice(0, 6)}…${asset.slice(-4)}`,
    defaultAmount: requestedAmount,
    environment
  };
}
