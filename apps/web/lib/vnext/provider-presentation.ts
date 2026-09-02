import type { VNextQuoteProvider } from "./quote-observation";

export type VNextProviderRoute = "direct" | "weth_hop" | "v4_pool";

const PROVIDER_LABELS: Readonly<Record<VNextQuoteProvider, string>> = Object.freeze({
  "uniswap-v2": "Uniswap V2",
  "uniswap-v3": "Uniswap V3",
  "uniswap-v4": "Uniswap V4",
  "up-v2": "UP V2",
  "up-cl": "UP CL",
  sushi: "Sushi",
  uniswapx: "UniswapX",
  "zero-x-swap": "0x Swap",
  "zero-x-gasless": "0x Gasless"
});

export function vNextProviderLabel(provider?: VNextQuoteProvider) {
  return provider ? PROVIDER_LABELS[provider] ?? null : null;
}

export function vNextProviderRoutePresentation(input: {
  provider: VNextQuoteProvider;
  route: VNextProviderRoute;
}) {
  const providerLabel = vNextProviderLabel(input.provider);
  if (!providerLabel) throw new Error("RMT cannot present an unknown execution provider.");
  if (input.route === "v4_pool") {
    return { providerLabel, routeLabel: "Canonical V4 PoolKey" } as const;
  }
  if (input.provider === "uniswap-v2") {
    return { providerLabel, routeLabel: input.route === "direct" ? "Direct V2" : "V2 via WETH" } as const;
  }
  if (input.provider === "uniswap-v3") {
    return { providerLabel, routeLabel: input.route === "direct" ? "Direct V3" : "V3 via WETH" } as const;
  }
  if (input.provider === "up-v2") {
    return { providerLabel, routeLabel: input.route === "direct" ? "Direct UP V2" : "UP V2 via WETH" } as const;
  }
  if (input.provider === "up-cl") {
    return { providerLabel, routeLabel: input.route === "direct" ? "Direct UP CL" : "UP CL via WETH" } as const;
  }
  return { providerLabel, routeLabel: input.route === "direct" ? `Direct ${providerLabel}` : `${providerLabel} via WETH` } as const;
}
