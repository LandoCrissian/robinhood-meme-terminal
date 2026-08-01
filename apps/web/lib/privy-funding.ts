export type PrivyFundingEnvironment = "sandbox" | "production";

export type PrivyFundingConfig = {
  enabled: boolean;
  chain: `eip155:${number}`;
  asset: string;
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

const ASSET_SYMBOL = /^[a-z][a-z0-9]{1,14}$/i;
const TOKEN_ADDRESS = /^0x[0-9a-f]{40}$/i;

export function parsePrivyFundingConfig(env: PrivyFundingPublicEnv): PrivyFundingConfig {
  const chainId = Number(env.chainId ?? "4663");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Privy funding requires a positive EVM chain ID.");
  }

  const asset = (env.asset ?? "eth").trim();
  if (!ASSET_SYMBOL.test(asset) && !TOKEN_ADDRESS.test(asset)) {
    throw new Error("Privy funding requires a token symbol or exact token contract address.");
  }

  const requestedAmount = (env.defaultAmount ?? "50").trim();
  const amount = Number(requestedAmount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 10_000) {
    throw new Error("Privy funding default amount must be between 1 and 10,000 fiat units.");
  }

  const environment = env.environment === "production" ? "production" : "sandbox";

  return {
    enabled: Boolean(env.appId?.trim()) && env.enabled === "true",
    chain: `eip155:${chainId}`,
    asset,
    defaultAmount: requestedAmount,
    environment
  };
}
